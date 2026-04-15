/**
 * oauth-callback-google.js — Google OAuth2 callback handler
 *
 * Flow:
 *  1. User clicks "Connect Google" in the frontend
 *  2. Frontend redirects to Google consent screen with this URL as redirect_uri
 *  3. Google redirects back here with ?code=... &state=<userId>
 *  4. We exchange the code for tokens, encrypt & save them, redirect to settings
 */

const { createRequestContext, buildLogPayload } = require('./_shared/observability');
const { writeRequestLog, getAdminClient }       = require('./_shared/supabase');
const { exchangeCodeForTokens }                 = require('./_shared/integrations/google-ads');
const { encrypt }                               = require('./_shared/crypto');
const { writeAudit }                            = require('./_shared/audit');
const { getEnv }                                = require('./_shared/env');

const resolveAppUrl = () => process.env.APP_URL || process.env.URL || '';
const REDIRECT_URI  = () => `${resolveAppUrl()}/.netlify/functions/oauth-callback-google`;

exports.handler = async (event) => {
  const context = createRequestContext(event, 'oauth-callback-google');

  const params   = event.queryStringParameters || {};
  const code     = params.code;
  const state    = params.state;  // We encode userId in state
  const errorParam = params.error;
  const env      = getEnv();
  const appUrl   = env.APP_URL;

  // Early env var check — fail fast with a clear error instead of a generic exchange failure
  if (!process.env.GOOGLE_OAUTH_CLIENT_ID || !process.env.GOOGLE_OAUTH_CLIENT_SECRET) {
    console.error('[oauth-google] Missing required env vars: GOOGLE_OAUTH_CLIENT_ID and/or GOOGLE_OAUTH_CLIENT_SECRET. Set them in Netlify environment variables.');
    return redirect(`${appUrl}/?error=google_not_configured`);
  }

  // User denied access
  if (errorParam) {
    await writeRequestLog(buildLogPayload(context, 'warn', 'google_oauth_denied', { error: errorParam }));
    return redirect(`${appUrl}/?error=google_denied`);
  }

  if (!code || !state) {
    return redirect(`${appUrl}/?error=google_missing_params`);
  }

  let userId;
  let provider;
  let nonce;
  try {
    const decoded  = Buffer.from(state, 'base64url').toString('utf8');
    const stateObj = JSON.parse(decoded);
    userId   = stateObj.userId;
    provider = stateObj.provider === 'ga4' ? 'ga4' : 'google_ads';
    nonce    = stateObj.nonce;
  } catch {
    return redirect(`${appUrl}/settings/integrations?error=google_invalid_state`);
  }

  // CSRF nonce validation — consume from DB (must exist and not be expired)
  if (nonce) {
    const sb = getAdminClient();
    const { data: nonceRow } = await sb
      .from('oauth_nonces')
      .select('nonce, expires_at')
      .eq('nonce', nonce)
      .eq('user_id', userId)
      .eq('provider', provider)
      .maybeSingle();

    if (!nonceRow || new Date(nonceRow.expires_at) < new Date()) {
      await writeRequestLog(buildLogPayload(context, 'warn', 'google_oauth_invalid_nonce', { user_id: userId }));
      return redirect(`${appUrl}/settings/integrations?error=google_invalid_state`);
    }
    // Delete nonce — one-time use
    await sb.from('oauth_nonces').delete().eq('nonce', nonce);
  }

  try {
    const { accessToken, refreshToken, expiresIn } = await exchangeCodeForTokens(code, REDIRECT_URI());

    // Encrypt the token bundle
    const secret = { accessToken, refreshToken, expiresIn, obtainedAt: Date.now() };
    const encrypted = encrypt(JSON.stringify(secret));

    const sb = getAdminClient();
    const { error } = await sb.from('user_integrations').upsert({
      user_id:           userId,
      provider:          provider,
      secret_ciphertext: encrypted.ciphertext,
      secret_iv:         encrypted.iv,
      secret_tag:        encrypted.tag,
      updated_at:        new Date().toISOString(),
    }, { onConflict: 'user_id,provider' });

    if (error) {
      console.error('[oauth-google] upsert error:', error.message);
      return redirect(`${appUrl}/settings/integrations?error=google_save_failed`);
    }

    await writeAudit({ userId, action: 'integration.connect', targetType: 'provider', targetId: provider, ip: context.ip, requestId: context.requestId });
    await writeRequestLog(buildLogPayload(context, 'info', 'google_oauth_connected', { user_id: userId, provider }));
    return redirect(`${appUrl}/settings/integrations?connected=${provider}`);
  } catch (err) {
    console.error('[oauth-google] error:', err.message);
    await writeRequestLog(buildLogPayload(context, 'error', 'google_oauth_failed', { user_id: userId, error: err.message }));
    return redirect(`${appUrl}/settings/integrations?error=google_exchange_failed`);
  }
};

function redirect(url) {
  return { statusCode: 302, headers: { Location: url }, body: '' };
}
