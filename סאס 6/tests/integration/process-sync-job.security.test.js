const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.APP_ENCRYPTION_KEY = process.env.APP_ENCRYPTION_KEY || 'test-encryption-key';
const { AppError } = require('../../netlify/functions/_shared/errors.js');
const handlerPath = require.resolve('../../netlify/functions/process-sync-job.js');
const authPath = require.resolve('../../netlify/functions/_shared/auth.js');
const supabasePath = require.resolve('../../netlify/functions/_shared/supabase.js');
const analyzePath = require.resolve('../../netlify/functions/_shared/analyze-service.js');

const originals = {
  auth: require.cache[authPath],
  supabase: require.cache[supabasePath],
  analyze: require.cache[analyzePath],
};

function restore() {
  delete require.cache[handlerPath];
  for (const [key, value] of Object.entries(originals)) {
    const path = key === 'auth' ? authPath : key === 'supabase' ? supabasePath : analyzePath;
    if (value) require.cache[path] = value;
    else delete require.cache[path];
  }
}

function loadHandler({ authImpl, supabaseClient, analyzeImpl }) {
  delete require.cache[handlerPath];
  require.cache[authPath] = { exports: { requireAuthOrInternal: authImpl } };
  require.cache[supabasePath] = { exports: { getAdminClient: () => supabaseClient } };
  require.cache[analyzePath] = { exports: { analyzeCampaign: analyzeImpl } };
  return require(handlerPath).handler;
}

test.afterEach(() => {
  restore();
});

test('process-sync-job blocks unauthorized access with 401', async () => {
  const handler = loadHandler({
    authImpl: async () => {
      throw new AppError({ code: 'UNAUTHORIZED', userMessage: 'לא מורשה', devMessage: 'Missing bearer token', status: 401 });
    },
    supabaseClient: {},
    analyzeImpl: async () => ({ analysisId: 'a-1' }),
  });

  const response = await handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ jobId: 'job-1' }), queryStringParameters: {} });
  const body = JSON.parse(response.body);

  assert.equal(response.statusCode, 401);
  assert.equal(body.code, 'UNAUTHORIZED');
});

test('process-sync-job rejects access to another user job with 403', async () => {
  const client = {
    from(table) {
      assert.equal(table, 'sync_jobs');
      return {
        select() { return this; },
        eq() { return this; },
        maybeSingle: async () => ({ data: { id: 'job-1', user_id: 'owner-1', status: 'queued', campaign_id: 'camp-1', payload: {} }, error: null }),
      };
    },
  };

  const handler = loadHandler({
    authImpl: async () => ({ mode: 'user', user: { id: 'other-user' } }),
    supabaseClient: client,
    analyzeImpl: async () => ({ analysisId: 'a-1' }),
  });

  const response = await handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ jobId: 'job-1' }), queryStringParameters: {} });
  const body = JSON.parse(response.body);

  assert.equal(response.statusCode, 403);
  assert.equal(body.code, 'FORBIDDEN');
});

test('process-sync-job returns 400 on broken JSON body', async () => {
  const handler = loadHandler({
    authImpl: async () => ({ mode: 'internal', user: null }),
    supabaseClient: {},
    analyzeImpl: async () => ({ analysisId: 'a-1' }),
  });

  const response = await handler({ httpMethod: 'POST', headers: { 'x-internal-secret': 'secret' }, body: '{bad-json', queryStringParameters: {} });
  const body = JSON.parse(response.body);

  assert.equal(response.statusCode, 400);
  assert.equal(body.code, 'BAD_REQUEST');
});
