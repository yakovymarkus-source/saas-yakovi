/**
 * oauth-nonce.js — Generate a server-side CSRF nonce for OAuth flows
 *
 * POST /oauth-nonce  { provider: 'ga4' | 'google_ads' | 'meta' }
 * Returns { nonce } — a one-time token valid for 10 minutes.
 *
 * The nonce is stored in oauth_nonces table (service-role only RLS).
 * The OAuth callback validates and deletes it before accepting the code.
 */

const { ok, fail }                              = require('./_shared/http');
const { createRequestContext, buildLogPayload }  = require('./_shared/observability');
const { writeRequestLog, getAdminClient }        = require('./_shared/supabase');
const { requireAuth }                            = require('./_shared/auth');
const { AppError }                               = require('./_shared/errors');
const { parseJsonBody, requireField }            = require('./_shared/request');
const crypto                                     = require('node:crypto');

const ALLOWED_PROVIDERS = ['ga4', 'google_ads', 'meta'];

exports.handler = async (event) => {
  const context = createRequestContext(event, 'oauth-nonce');
  try {
    if (event.httpMethod !== 'POST') {
      throw new AppError({ code: 'METHOD_NOT_ALLOWED', userMessage: 'Method not allowed', devMessage: 'Unsupported method', status: 405 });
    }

    const user     = await requireAuth(event, context.functionName, context);
    const body     = parseJsonBody(event, { fallback: {}, allowEmpty: false, devMessage: 'Missing provider' });
    const provider = requireField(body.provider, 'provider');

    if (!ALLOWED_PROVIDERS.includes(provider)) {
      throw new AppError({ code: 'BAD_REQUEST', userMessage: 'provider לא חוקי', devMessage: `Unknown provider: ${provider}`, status: 400 });
    }

    const nonce     = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const sb        = getAdminClient();

    // Clean up any stale nonces for this user+provider before inserting
    await sb.from('oauth_nonces').delete().eq('user_id', user.id).eq('provider', provider);

    const { error } = await sb.from('oauth_nonces').insert({ nonce, user_id: user.id, provider, expires_at: expiresAt });
    if (error) {
      throw new AppError({ code: 'DB_WRITE_FAILED', userMessage: 'יצירת nonce נכשלה', devMessage: error.message, status: 500 });
    }

    await writeRequestLog(buildLogPayload(context, 'info', 'oauth_nonce_created', { user_id: user.id, provider }));
    return ok({ nonce }, context.requestId);
  } catch (error) {
    await writeRequestLog(buildLogPayload(context, 'error', error.message || 'oauth_nonce_failed', { code: error.code || 'INTERNAL_ERROR' })).catch(() => {});
    return fail(error, context.requestId);
  }
};
