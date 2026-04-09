const test = require('node:test');
const assert = require('node:assert/strict');
const { createRealTestDb } = require('../helpers/sqlite-test-db.js');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.APP_ENCRYPTION_KEY = process.env.APP_ENCRYPTION_KEY || 'test-encryption-key';
process.env.SYNC_JOB_INTERNAL_SECRET = process.env.SYNC_JOB_INTERNAL_SECRET || 'secret';
const enqueueHandlerPath = require.resolve('../../netlify/functions/enqueue-sync-job.js');
const processHandlerPath = require.resolve('../../netlify/functions/process-sync-job.js');
const authPath = require.resolve('../../netlify/functions/_shared/auth.js');

const originalAuth = require.cache[authPath];

function restore(db) {
  delete require.cache[enqueueHandlerPath];
  delete require.cache[processHandlerPath];
  if (originalAuth) require.cache[authPath] = originalAuth; else delete require.cache[authPath];
  delete global.__TEST_SUPABASE_CLIENT__;
  db?.close();
}

function loadHandlers(client) {
  global.__TEST_SUPABASE_CLIENT__ = client;
  require.cache[authPath] = {
    exports: {
      requireAuth: async () => ({ id: 'user-1' }),
      requireAuthOrInternal: async () => ({ mode: 'internal', user: null }),
    },
  };
  return {
    enqueue: require(enqueueHandlerPath).handler,
    process: require(processHandlerPath).handler,
  };
}

test('real enqueue -> process flow persists exactly one fully linked analysis with no orphans on DB-backed package', async () => {
  const db = createRealTestDb();
  db.seedUser({ id: 'user-1' });
  db.seedCampaign({ id: 'camp-1', ownerUserId: 'user-1' });
  const { enqueue, process } = loadHandlers(db.client);

  const enqueueResponse = await enqueue({ httpMethod: 'POST', headers: { authorization: 'Bearer token' }, body: JSON.stringify({ campaignId: 'camp-1', clicks: 12, impressions: 100 }), queryStringParameters: {} });
  assert.equal(enqueueResponse.statusCode, 202);
  const enqueueBody = JSON.parse(enqueueResponse.body);
  const jobId = enqueueBody.data.jobId;

  const processResponse = await process({ httpMethod: 'POST', headers: { 'x-internal-secret': 'secret' }, body: JSON.stringify({ jobId }), queryStringParameters: {} });
  assert.equal(processResponse.statusCode, 200);
  const processBody = JSON.parse(processResponse.body);

  assert.equal(processBody.data.jobId, jobId);
  assert.equal(processBody.data.status, 'done');
  assert.equal(db.count('sync_jobs'), 1);
  assert.equal(db.getJob(jobId).status, 'done');
  assert.equal(db.count('analysis_results'), 1);
  assert.equal(db.count('campaign_snapshots'), 1);
  assert.equal(db.count('decision_history'), 1);
  assert.equal(db.count('recommendations'), 1);
  assert.deepEqual(db.findOrphans(), { campaign_snapshots: [], decision_history: [], recommendations: [] });
  assert.ok(db.getLogMessages().includes('sync_job_enqueued'));
  assert.ok(db.getLogMessages().includes('process_sync_job_done'));

  restore(db);
});
