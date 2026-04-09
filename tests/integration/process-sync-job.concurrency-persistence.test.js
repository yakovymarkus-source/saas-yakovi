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

test('process-sync-job proves parallel concurrency against real persistence with one final analysis', async () => {
  const db = createRealTestDb({ queryDelayMs: 2, rpcDelayMs: 8 });
  db.seedUser({ id: 'user-1' });
  db.seedJob({ id: 'job-race', userId: 'user-1', campaignId: 'camp-race', payload: { campaignId: 'camp-race', clicks: 33, impressions: 400 } });
  const handler = loadHandler(db.client);
  const event = { httpMethod: 'POST', headers: { 'x-internal-secret': 'secret' }, body: JSON.stringify({ jobId: 'job-race' }), queryStringParameters: {} };

  const runners = Array.from({ length: 16 }, (_, i) => new Promise((resolve) => setTimeout(() => resolve(handler(event)), i % 4)));
  const results = await Promise.all(runners);
  const codes = results.map((result) => result.statusCode);

  assert.equal(codes.filter((code) => code === 200).length, 1);
  assert.equal(codes.filter((code) => code === 409).length, 15);
  assert.equal(db.getJob('job-race').status, 'done');
  assert.equal(db.count('analysis_results'), 1);
  assert.equal(db.count('campaign_snapshots'), 1);
  assert.equal(db.count('decision_history'), 1);
  assert.equal(db.count('recommendations'), 1);
  assert.deepEqual(db.findOrphans(), { campaign_snapshots: [], decision_history: [], recommendations: [] });

  restore(db);
});
