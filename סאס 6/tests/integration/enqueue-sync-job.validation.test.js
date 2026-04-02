const test = require('node:test');
const assert = require('node:assert/strict');

const handlerPath = require.resolve('../../netlify/functions/enqueue-sync-job.js');
const authPath = require.resolve('../../netlify/functions/_shared/auth.js');
const authzPath = require.resolve('../../netlify/functions/_shared/authz/access.js');
const supabasePath = require.resolve('../../netlify/functions/_shared/supabase.js');
const observabilityPath = require.resolve('../../netlify/functions/_shared/observability.js');

const originals = {
  auth: require.cache[authPath],
  authz: require.cache[authzPath],
  supabase: require.cache[supabasePath],
  observability: require.cache[observabilityPath],
};

function restore() {
  delete require.cache[handlerPath];
  if (originals.auth) require.cache[authPath] = originals.auth; else delete require.cache[authPath];
  if (originals.authz) require.cache[authzPath] = originals.authz; else delete require.cache[authzPath];
  if (originals.supabase) require.cache[supabasePath] = originals.supabase; else delete require.cache[supabasePath];
  if (originals.observability) require.cache[observabilityPath] = originals.observability; else delete require.cache[observabilityPath];
}

function loadHandler() {
  delete require.cache[handlerPath];
  require.cache[authPath] = { exports: { requireAuth: async () => ({ id: 'user-1' }) } };
  require.cache[authzPath] = { exports: { authorizeCampaignAccess: async () => ({}) } };
  require.cache[supabasePath] = { exports: { getAdminClient: () => ({ from() { throw new Error('should not reach DB'); } }), writeRequestLog: async () => {} } };
  require.cache[observabilityPath] = { exports: { createRequestContext: () => ({ requestId: 'req-1', functionName: 'enqueue-sync-job', correlationId: 'corr-1', startedAt: Date.now(), ip: '127.0.0.1', userAgent: 'test' }), buildLogPayload: () => ({}) } };
  return require(handlerPath).handler;
}

test.afterEach(() => {
  restore();
});

test('enqueue-sync-job returns 400 on invalid JSON', async () => {
  const handler = loadHandler();
  const response = await handler({ httpMethod: 'POST', headers: {}, body: '{bad-json', queryStringParameters: {} });
  const body = JSON.parse(response.body);
  assert.equal(response.statusCode, 400);
  assert.equal(body.code, 'BAD_REQUEST');
});

test('enqueue-sync-job returns 400 when campaignId missing', async () => {
  const handler = loadHandler();
  const response = await handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify({}), queryStringParameters: {} });
  const body = JSON.parse(response.body);
  assert.equal(response.statusCode, 400);
  assert.equal(body.code, 'BAD_REQUEST');
});
