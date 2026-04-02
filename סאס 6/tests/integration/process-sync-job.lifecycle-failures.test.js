const test = require('node:test');
const assert = require('node:assert/strict');
const { createRealTestDb } = require('../helpers/sqlite-test-db.js');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.APP_ENCRYPTION_KEY = process.env.APP_ENCRYPTION_KEY || 'test-encryption-key';
process.env.SYNC_JOB_INTERNAL_SECRET = process.env.SYNC_JOB_INTERNAL_SECRET || 'secret';
const handlerPath = require.resolve('../../netlify/functions/process-sync-job.js');
const authPath = require.resolve('../../netlify/functions/_shared/auth.js');

const originalAuth = require.cache[authPath];

function restore(db) {
  delete require.cache[handlerPath];
  if (originalAuth) require.cache[authPath] = originalAuth; else delete require.cache[authPath];
  delete global.__TEST_SUPABASE_CLIENT__;
  db?.close();
}

function loadHandler(client) {
  global.__TEST_SUPABASE_CLIENT__ = client;
  require.cache[authPath] = { exports: { requireAuthOrInternal: async () => ({ mode: 'internal', user: null }) } };
  return require(handlerPath).handler;
}

test('process-sync-job returns explicit error when loadJob fails and keeps real persistence clean', async () => {
  const db = createRealTestDb({ failLoadJobIds: ['job-load-fail'] });
  db.seedUser({ id: 'user-1' });
  db.seedJob({ id: 'job-load-fail', userId: 'user-1', campaignId: 'camp-1', payload: { campaignId: 'camp-1', clicks: 5 } });
  const handler = loadHandler(db.client);

  const response = await handler({ httpMethod: 'POST', headers: { 'x-internal-secret': 'secret' }, body: JSON.stringify({ jobId: 'job-load-fail' }), queryStringParameters: {} });
  const body = JSON.parse(response.body);

  assert.equal(response.statusCode, 500);
  assert.equal(body.code, 'DB_READ_FAILED');
  assert.equal(db.getJob('job-load-fail').status, 'queued');
  assert.equal(db.count('analysis_results'), 0);
  assert.deepEqual(db.findOrphans(), { campaign_snapshots: [], decision_history: [], recommendations: [] });
  assert.ok(db.getLogMessages().includes('process_sync_job_failed'));

  restore(db);
});

test('process-sync-job fails explicitly when markJobDone fails and does not leave orphaned real persistence', async () => {
  const db = createRealTestDb({ failMarkDoneJobIds: ['job-done-fail'] });
  db.seedUser({ id: 'user-1' });
  db.seedJob({ id: 'job-done-fail', userId: 'user-1', campaignId: 'camp-2', payload: { campaignId: 'camp-2', clicks: 9 } });
  const handler = loadHandler(db.client);

  const response = await handler({ httpMethod: 'POST', headers: { 'x-internal-secret': 'secret' }, body: JSON.stringify({ jobId: 'job-done-fail' }), queryStringParameters: {} });
  const body = JSON.parse(response.body);

  assert.equal(response.statusCode, 500);
  assert.equal(body.code, 'DB_WRITE_FAILED');
  assert.equal(db.getJob('job-done-fail').status, 'failed');
  assert.equal(db.count('analysis_results'), 1);
  assert.equal(db.count('campaign_snapshots'), 1);
  assert.equal(db.count('decision_history'), 1);
  assert.equal(db.count('recommendations'), 1);
  assert.deepEqual(db.findOrphans(), { campaign_snapshots: [], decision_history: [], recommendations: [] });
  assert.ok(db.getLogMessages().includes('process_sync_job_failed'));

  restore(db);
});

test('process-sync-job surfaces markJobFailed failure explicitly without corrupting real persistence', async () => {
  const db = createRealTestDb({ rpcError: new Error('rpc exploded'), failMarkFailedJobIds: ['job-fail-fail'] });
  db.seedUser({ id: 'user-1' });
  db.seedJob({ id: 'job-fail-fail', userId: 'user-1', campaignId: 'camp-3', payload: { campaignId: 'camp-3', clicks: 0 } });
  const handler = loadHandler(db.client);

  const response = await handler({ httpMethod: 'POST', headers: { 'x-internal-secret': 'secret' }, body: JSON.stringify({ jobId: 'job-fail-fail' }), queryStringParameters: {} });
  const body = JSON.parse(response.body);

  assert.equal(response.statusCode, 500);
  assert.equal(body.code, 'DB_WRITE_FAILED');
  assert.match(body.message, /עדכון המשימה נכשל/);
  assert.equal(db.getJob('job-fail-fail').status, 'running');
  assert.equal(db.count('analysis_results'), 0);
  assert.equal(db.count('campaign_snapshots'), 0);
  assert.equal(db.count('decision_history'), 0);
  assert.equal(db.count('recommendations'), 0);
  assert.deepEqual(db.findOrphans(), { campaign_snapshots: [], decision_history: [], recommendations: [] });
  assert.ok(db.getLogMessages().includes('process_sync_job_claimed'));
  assert.ok(db.getLogMessages().includes('process_sync_job_failed'));

  restore(db);
});
