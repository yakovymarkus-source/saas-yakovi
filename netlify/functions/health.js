/**
 * health.js — Public health-check endpoint
 *
 * GET  /health        → basic liveness (no auth)
 * GET  /health?full=1 → deep check with DB ping (requires HEALTH_SECRET header)
 */

const { ok, fail, respond }          = require('./_shared/http');
const { createRequestContext }       = require('./_shared/observability');
const { getAdminClient }             = require('./_shared/supabase');
const { getHeader }                  = require('./_shared/request');

exports.handler = async (event) => {
  const context = createRequestContext(event, 'health');

  if (event.httpMethod !== 'GET') {
    return respond(405, { ok: false, message: 'Method not allowed' }, context.requestId);
  }

  // Basic liveness — always public
  const base = {
    status:    'ok',
    timestamp: new Date().toISOString(),
    version:   process.env.ANALYSIS_VERSION || '1.0.0',
  };

  const full = event.queryStringParameters?.full === '1';
  if (!full) return ok(base, context.requestId);

  // Deep check — requires HEALTH_SECRET header
  const secret = process.env.HEALTH_SECRET;
  const provided = getHeader(event, 'x-health-secret');
  if (secret && provided !== secret) {
    return respond(403, { ok: false, message: 'Forbidden' }, context.requestId);
  }

  const checks = { db: 'unknown' };
  try {
    const sb = getAdminClient();
    const { error } = await sb.from('profiles').select('id').limit(1);
    checks.db = error ? `error: ${error.message}` : 'ok';
  } catch (err) {
    checks.db = `error: ${err.message}`;
  }

  const allOk = Object.values(checks).every(v => v === 'ok');
  return respond(
    allOk ? 200 : 503,
    { ...base, checks, status: allOk ? 'ok' : 'degraded' },
    context.requestId,
  );
};
