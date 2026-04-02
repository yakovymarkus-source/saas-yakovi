const test = require('node:test');
const assert = require('node:assert/strict');
const { createRealTestDb } = require('../helpers/sqlite-test-db.js');

const supabasePath = require.resolve('../../netlify/functions/_shared/supabase.js');
const envPath = require.resolve('../../netlify/functions/_shared/env.js');
const persistencePath = require.resolve('../../netlify/functions/_shared/persistence.js');

const originalSupabase = require.cache[supabasePath];
const originalEnv = require.cache[envPath];

function loadPersistenceWith(client) {
  delete require.cache[persistencePath];
  require.cache[supabasePath] = { exports: { getAdminClient: () => client } };
  require.cache[envPath] = { exports: { getEnv: () => ({ ANALYSIS_VERSION: '1.0.0' }) } };
  return require(persistencePath);
}

function restoreModules() {
  delete require.cache[persistencePath];
  if (originalSupabase) require.cache[supabasePath] = originalSupabase; else delete require.cache[supabasePath];
  if (originalEnv) require.cache[envPath] = originalEnv; else delete require.cache[envPath];
}

test.afterEach(() => {
  restoreModules();
});

test('persistAnalysis uses one atomic RPC and returns analysis id from real DB-backed client', async () => {
  const db = createRealTestDb();
  db.seedUser({ id: 'user-1' });
  const { persistAnalysis } = loadPersistenceWith(db.client);

  const analysisId = await persistAnalysis({
    userId: 'user-1',
    campaignId: 'campaign-1',
    requestId: 'req-1',
    rawSnapshot: { totals: {} },
    metrics: { clicks: 10 },
    scores: { overall: 80 },
    bottlenecks: [],
    decisions: [{ verdict: 'Tracking problem', reason: 'x', confidence: 70 }],
    recommendations: [{ issue: 'A', rootCause: 'B', action: 'C', expectedImpact: 'D', urgency: 80, effort: 20, confidence: 70, priorityScore: 88 }],
    confidence: 77,
  });

  assert.ok(analysisId);
  assert.equal(db.count('analysis_results'), 1);
  assert.equal(db.count('campaign_snapshots'), 1);
  assert.equal(db.count('decision_history'), 1);
  assert.equal(db.count('recommendations'), 1);
  db.close();
});

test('persistAnalysis proves atomic rollback on mid-failure against real DB tables', async () => {
  const db = createRealTestDb({ failMidPersistence: true });
  db.seedUser({ id: 'user-1' });
  const { persistAnalysis } = loadPersistenceWith(db.client);

  await assert.rejects(
    () => persistAnalysis({
      userId: 'user-1',
      campaignId: 'campaign-1',
      requestId: 'req-1',
      rawSnapshot: { totals: {} },
      metrics: { clicks: 10 },
      scores: { overall: 80 },
      bottlenecks: [],
      decisions: [{ verdict: 'Tracking problem', reason: 'x', confidence: 70 }],
      recommendations: [{ issue: 'A', rootCause: 'B', action: 'C', expectedImpact: 'D', urgency: 80, effort: 20, confidence: 70, priorityScore: 88 }],
      confidence: 77,
    }),
    (error) => {
      assert.equal(error.code, 'DB_WRITE_FAILED');
      assert.match(error.devMessage, /persist_analysis_atomic failed/);
      return true;
    },
  );

  assert.deepEqual(db.getCounts(), {
    analysis_results: 0,
    campaign_snapshots: 0,
    decision_history: 0,
    recommendations: 0,
    sync_jobs: 0,
    request_logs: 0,
  });
  db.close();
});

test('persistAnalysis rejects invalid rpc response shape from DB-backed client', async () => {
  const db = createRealTestDb({ rpcInvalidShape: true });
  db.seedUser({ id: 'user-1' });
  const { persistAnalysis } = loadPersistenceWith(db.client);

  await assert.rejects(
    () => persistAnalysis({
      userId: 'user-1',
      campaignId: 'campaign-1',
      requestId: 'req-1',
      rawSnapshot: {},
      metrics: {},
      scores: {},
      bottlenecks: [],
      decisions: [],
      recommendations: [],
      confidence: 77,
    }),
    (error) => {
      assert.equal(error.code, 'DB_WRITE_FAILED');
      assert.match(error.devMessage, /invalid response shape/);
      return true;
    },
  );
  db.close();
});
