const test = require('node:test');
const assert = require('node:assert/strict');
const { createRealTestDb } = require('../helpers/sqlite-test-db.js');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.APP_ENCRYPTION_KEY = process.env.APP_ENCRYPTION_KEY || 'test-encryption-key';
process.env.APP_URL = process.env.APP_URL || 'http://localhost:3000';
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

test('process-sync-job failure in atomic persistence marks job failed, emits logs, and leaves no orphans on real DB', async () => {
  const db = createRealTestDb({ failMidPersistence: true });
  db.seedUser({ id: 'user-1' });
  db.seedJob({ id: 'job-1', userId: 'user-1', campaignId: 'camp-1', payload: { campaignId: 'camp-1', clicks: 0 } });
  const handler = loadHandler(db.client);

  const response = await handler({ httpMethod: 'POST', headers: { 'x-internal-secret': 'secret' }, body: JSON.stringify({ jobId: 'job-1' }), queryStringParameters: {} });
  const body = JSON.parse(response.body);

  assert.equal(response.statusCode, 500);
  assert.equal(body.code, 'DB_WRITE_FAILED');
  assert.equal(db.getJob('job-1').status, 'failed');
  assert.equal(db.count('analysis_results'), 0);
  assert.equal(db.count('campaign_snapshots'), 0);
  assert.equal(db.count('decision_history'), 0);
  assert.equal(db.count('recommendations'), 0);
  assert.deepEqual(db.findOrphans(), { campaign_snapshots: [], decision_history: [], recommendations: [] });
  assert.ok(db.getLogMessages().includes('process_sync_job_authenticated'));
  assert.ok(db.getLogMessages().includes('process_sync_job_failed'));

  restore(db);
});

test('process-sync-job returns explicit error on invalid persistence response shape and leaves real DB state clean', async () => {
  const db = createRealTestDb({ rpcInvalidShape: true });
  db.seedUser({ id: 'user-1' });
  db.seedJob({ id: 'job-2', userId: 'user-1', campaignId: 'camp-2', payload: { campaignId: 'camp-2', clicks: 2 } });
  const handler = loadHandler(db.client);

  const response = await handler({ httpMethod: 'POST', headers: { 'x-internal-secret': 'secret' }, body: JSON.stringify({ jobId: 'job-2' }), queryStringParameters: {} });
  const body = JSON.parse(response.body);

  assert.equal(response.statusCode, 500);
  assert.equal(body.code, 'DB_WRITE_FAILED');
  assert.equal(db.getJob('job-2').status, 'failed');
  assert.equal(db.count('analysis_results'), 1);
  assert.equal(db.count('campaign_snapshots'), 1);
  assert.equal(db.count('decision_history'), 1);
  assert.equal(db.count('recommendations'), 1);
  assert.deepEqual(db.findOrphans(), { campaign_snapshots: [], decision_history: [], recommendations: [] });

  restore(db);
});
