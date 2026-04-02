const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.APP_ENCRYPTION_KEY = process.env.APP_ENCRYPTION_KEY || 'test-encryption-key';
const handlerPath = require.resolve('../../netlify/functions/process-sync-job.js');
const supabasePath = require.resolve('../../netlify/functions/_shared/supabase.js');
const authPath = require.resolve('../../netlify/functions/_shared/auth.js');
const observabilityPath = require.resolve('../../netlify/functions/_shared/observability.js');

const originals = {
  supabase: require.cache[supabasePath],
  auth: require.cache[authPath],
  observability: require.cache[observabilityPath],
};

function restore() {
  delete require.cache[handlerPath];
  for (const [name, value] of Object.entries(originals)) {
    const path = name === 'supabase' ? supabasePath : name === 'auth' ? authPath : observabilityPath;
    if (value) require.cache[path] = value; else delete require.cache[path];
  }
  delete global.__TEST_SUPABASE_CLIENT__;
}

function createState() {
  return {
    jobs: [{ id: 'job-1', user_id: 'user-1', campaign_id: 'camp-1', status: 'queued', payload: { campaignId: 'camp-1', clicks: 17 } }],
    analysis_results: [],
    campaign_snapshots: [],
    decision_history: [],
    recommendations: [],
    request_logs: [],
    logWrites: [],
  };
}

function createClient(state) {
  return {
    from(table) {
      if (table === 'request_logs') {
        return { insert: async (row) => { state.request_logs.push(row); return { data: row, error: null }; } };
      }
      assert.equal(table, 'sync_jobs');
      const ctx = { filters: [], updateValues: null };
      return {
        select() { return this; },
        eq(field, value) { ctx.filters.push([field, value]); return this; },
        update(values) { ctx.updateValues = values; return this; },
        async maybeSingle() {
          await new Promise((resolve) => setTimeout(resolve, 2));
          const record = state.jobs.find((job) => ctx.filters.every(([field, value]) => job[field] === value)) || null;
          if (!record) return { data: null, error: null };
          if (ctx.updateValues) {
            Object.assign(record, ctx.updateValues);
          }
          return { data: { ...record }, error: null };
        },
      };
    },
    async rpc(name, params) {
      assert.equal(name, 'persist_analysis_atomic');
      const analysisId = `analysis-${state.analysis_results.length + 1}`;
      await new Promise((resolve) => setTimeout(resolve, 10));
      state.analysis_results.push({ id: analysisId, ...params.p_payload.analysis_result });
      state.campaign_snapshots.push({ id: `snapshot-${state.campaign_snapshots.length + 1}`, analysis_result_id: analysisId, ...params.p_payload.campaign_snapshot });
      for (const item of params.p_payload.decisions || []) state.decision_history.push({ analysis_result_id: analysisId, ...item });
      for (const item of params.p_payload.recommendations || []) state.recommendations.push({ analysis_result_id: analysisId, ...item });
      return { data: analysisId, error: null };
    },
    async writeRequestLog(payload) {
      state.request_logs.push(payload);
      state.logWrites.push(payload.message);
    },
  };
}

function loadHandler(client) {
  delete require.cache[handlerPath];
  global.__TEST_SUPABASE_CLIENT__ = client;
  require.cache[authPath] = { exports: { requireAuthOrInternal: async () => ({ mode: 'internal', user: null }) } };
  require.cache[observabilityPath] = { exports: { createRequestContext: () => ({ requestId: 'req-1', correlationId: 'corr-1', functionName: 'process-sync-job', startedAt: Date.now(), ip: '127.0.0.1', userAgent: 'test' }), buildLogPayload: (_, level, message, metadata) => ({ level, message, metadata }) } };
  return require(handlerPath).handler;
}

test.afterEach(restore);

test('process-sync-job allows only one successful worker under high contention', async () => {
  const state = createState();
  const handler = loadHandler(createClient(state));
  const event = { httpMethod: 'POST', headers: { 'x-internal-secret': 'secret' }, body: JSON.stringify({ jobId: 'job-1' }), queryStringParameters: {} };

  const results = await Promise.all(Array.from({ length: 8 }, () => handler(event)));
  const codes = results.map((result) => result.statusCode);
  const successCount = codes.filter((code) => code === 200).length;
  const conflictCount = codes.filter((code) => code === 409).length;

  assert.equal(successCount, 1);
  assert.equal(conflictCount, 7);
  assert.equal(state.jobs[0].status, 'done');
  assert.equal(state.analysis_results.length, 1);
  assert.equal(state.campaign_snapshots.length, 1);
  assert.equal(state.decision_history.length, 1);
  assert.equal(state.recommendations.length, 1);
  assert.ok(state.logWrites.includes('process_sync_job_claimed'));
  assert.ok(state.logWrites.includes('process_sync_job_done'));
});
