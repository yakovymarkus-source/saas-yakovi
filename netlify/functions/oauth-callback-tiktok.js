/**
 * oauth-callback-tiktok.js — TikTok OAuth callback handler
 */

const { createRequestContext, buildLogPayload } = require('./_shared/observability');
const { writeRequestLog, getAdminClient }       = require('./_shared/supabase');
const { exchangeCodeForToken }                  = require('./_shared/integrations/tiktok');
const { encrypt }                               = require('./_shared/crypto');
const { writeAudit }                            = require('./_shared/audit');

const resolveAppUrl = () => process.env.APP_URL || process.env.URL || '';
const REDIRECT_URI  = () => `${resolveAppUrl()}/.netlify/functions/oauth-callback-tiktok`;

exports.handler = async (event) => {
  const context    = createRequestContext(event, 'oauth-callback-tiktok');
  const params     = event.queryStringParameters || {};
  const code       = params.code;
  const state      = params.state;
  const errorParam = params.error;
  const appUrl     = resolveAppUrl();

  console.log('[oauth-tiktok] incoming', {
    method:    event.httpMethod,
    appUrl,
    hasCode:   !!code,
    hasState:  !!state,
    hasError:  !!errorParam,
    allParams: Object.keys(params),
  });

  if (errorParam) {
    await writeRequestLog(buildLogPayload(context, 'warn', 'tiktok_oauth_denied', { error: errorParam }));
    return redirect(`${appUrl}/?error=tiktok_denied`);
  }

  if (!code || !state) {
    await writeRequestLog(buildLogPayload(context, 'warn', 'tiktok_oauth_missing_params', {
      hasCode: !!code, hasState: !!state,
    }));
    return redirect(`${appUrl}/?error=tiktok_missing_params`);
  }

  let userId;
  let nonce;
  try {
    const decoded  = Buffer.from(state, 'base64url').toString('utf8');
    const stateObj = JSON.parse(decoded);
    userId = stateObj.userId;
    nonce  = stateObj.nonce;
  } catch {
    return redirect(`${appUrl}/?error=tiktok_invalid_state`);
  }

  // CSRF nonce validation
  if (nonce) {
    const sb = getAdminClient();
    const { data: nonceRow } = await sb
      .from('oauth_nonces')
      .select('nonce, expires_at')
      .eq('nonce', nonce)
      .eq('user_id', userId)
      .eq('provider', 'tiktok')
      .maybeSingle();

    if (!nonceRow || new Date(nonceRow.expires_at) < new Date()) {
      await writeRequestLog(buildLogPayload(context, 'warn', 'tiktok_oauth_invalid_nonce', { user_id: userId }));
      return redirect(`${appUrl}/?error=tiktok_invalid_state`);
    }
    await getAdminClient().from('oauth_nonces').delete().eq('nonce', nonce);
  }

  try {
    const { accessToken, refreshToken, expiresIn, refreshExpiresIn } = await exchangeCodeForToken(code, REDIRECT_URI());

    const secret    = { accessToken, refreshToken, expiresIn, refreshExpiresIn, obtainedAt: Date.now() };
    const encrypted = encrypt(JSON.stringify(secret));

    const sb = getAdminClient();
    const { error } = await sb.from('user_integrations').upsert({
      user_id:           userId,
      provider:          'tiktok',
      secret_ciphertext: encrypted.ciphertext,
      secret_iv:         encrypted.iv,
      secret_tag:        encrypted.tag,
      updated_at:        new Date().toISOString(),
    }, { onConflict: 'user_id,provider' });

    if (error) {
      console.error('[oauth-tiktok] upsert error:', error.message);
      return redirect(`${appUrl}/?error=tiktok_save_failed`);
    }

    await writeAudit({ userId, action: 'integration.connect', targetType: 'provider', targetId: 'tiktok', ip: context.ip, requestId: context.requestId });
    await writeRequestLog(buildLogPayload(context, 'info', 'tiktok_oauth_connected', { user_id: userId }));
    return redirect(`${appUrl}/?connected=tiktok`);
  } catch (err) {
    console.error('[oauth-tiktok] error:', err.message);
    await writeRequestLog(buildLogPayload(context, 'error', 'tiktok_oauth_failed', { user_id: userId, error: err.message }));
    return redirect(`${appUrl}/?error=tiktok_exchange_failed`);
  }
};

function redirect(url) {
  return { statusCode: 302, headers: { Location: url }, body: '' };
}
