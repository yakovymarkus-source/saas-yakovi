/**
 * integration-connect.js — Save or update an integration connection
 *
 * POST  /integration-connect  — save a new integration (with encrypted secret)
 * DELETE /integration-connect — disconnect an integration
 * GET   /integration-connect  — list connected integrations (status only, no secrets)
 */

const { ok, fail, options }                     = require('./_shared/http');
const { createRequestContext, buildLogPayload }  = require('./_shared/observability');
const { writeRequestLog, getAdminClient }        = require('./_shared/supabase');
const { requireAuth }                            = require('./_shared/auth');
const { encrypt }                                = require('./_shared/crypto');
const { writeAudit }                             = require('./_shared/audit');
const { AppError }                               = require('./_shared/errors');
const { parseJsonBody, requireField }            = require('./_shared/request');

const ALLOWED_PROVIDERS = ['ga4', 'meta', 'google_ads'];

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options();
  const context = createRequestContext(event, 'integration-connect');
  try {
    const user = await requireAuth(event, context.functionName, context);
    const sb   = getAdminClient();

    // ── GET: list connections ────────────────────────────────────────────────
    if (event.httpMethod === 'GET') {
      const { data, error } = await sb
        .from('user_integrations')
        .select('provider, account_id, account_name, property_id, metadata, connection_status, last_sync_at, last_error, created_at, updated_at')
        .eq('user_id', user.id);

      if (error) throw new AppError({ code: 'DB_READ_FAILED', userMessage: 'טעינת האינטגרציות נכשלה', devMessage: error.message, status: 500 });
      return ok(data || [], context.requestId);
    }

    // ── DELETE: disconnect ───────────────────────────────────────────────────
    if (event.httpMethod === 'DELETE') {
      const body     = parseJsonBody(event, { fallback: {}, allowEmpty: false, devMessage: 'Missing provider' });
      const provider = requireField(body.provider, 'provider');
      if (!ALLOWED_PROVIDERS.includes(provider)) {
        throw new AppError({ code: 'BAD_REQUEST', userMessage: 'provider לא חוקי', devMessage: `Unknown provider: ${provider}`, status: 400 });
      }
      const { error } = await sb.from('user_integrations').delete().eq('user_id', user.id).eq('provider', provider);
      if (error) throw new AppError({ code: 'DB_WRITE_FAILED', userMessage: 'ניתוק האינטגרציה נכשל', devMessage: error.message, status: 500 });

      await writeAudit({ userId: user.id, action: 'integration.disconnect', targetType: 'provider', targetId: provider, ip: context.ip, requestId: context.requestId });
      await writeRequestLog(buildLogPayload(context, 'info', 'integration_disconnected', { user_id: user.id, provider }));
      return ok({ disconnected: true, provider }, context.requestId);
    }

    // ── POST: connect ────────────────────────────────────────────────────────
    if (event.httpMethod === 'POST') {
      const body       = parseJsonBody(event, { fallback: {}, allowEmpty: false, devMessage: 'Missing integration data' });
      const provider   = requireField(body.provider, 'provider');
      const secretData = requireField(body.secret,   'secret');

      if (!ALLOWED_PROVIDERS.includes(provider)) {
        throw new AppError({ code: 'BAD_REQUEST', userMessage: 'provider לא חוקי', devMessage: `Unknown provider: ${provider}`, status: 400 });
      }
      if (typeof secretData !== 'object') {
        throw new AppError({ code: 'BAD_REQUEST', userMessage: 'secret חייב להיות אובייקט', devMessage: 'secret field must be object', status: 400 });
      }

      const encrypted = encrypt(JSON.stringify(secretData));
      const row = {
        user_id:           user.id,
        provider,
        account_id:        body.accountId   || null,
        property_id:       body.propertyId  || null,
        metadata:          body.metadata    || {},
        secret_ciphertext: encrypted.ciphertext,
        secret_iv:         encrypted.iv,
        secret_tag:        encrypted.tag,
        updated_at:        new Date().toISOString(),
      };

      const { error } = await sb.from('user_integrations').upsert(row, { onConflict: 'user_id,provider' });
      if (error) throw new AppError({ code: 'DB_WRITE_FAILED', userMessage: 'שמירת האינטגרציה נכשלה', devMessage: error.message, status: 500 });

      await writeAudit({ userId: user.id, action: 'integration.connect', targetType: 'provider', targetId: provider, ip: context.ip, requestId: context.requestId });
      await writeRequestLog(buildLogPayload(context, 'info', 'integration_connected', { user_id: user.id, provider }));
      return ok({ connected: true, provider }, context.requestId);
    }

    throw new AppError({ code: 'METHOD_NOT_ALLOWED', userMessage: 'Method not allowed', devMessage: 'Unsupported method', status: 405 });
  } catch (error) {
    await writeRequestLog(buildLogPayload(context, 'error', error.message || 'integration_connect_failed', { code: error.code || 'INTERNAL_ERROR' })).catch(() => {});
    return fail(error, context.requestId);
  }
};
