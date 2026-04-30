/**
 * oauth-callback-meta.js — Meta (Facebook) OAuth callback handler
 */

const { createRequestContext, buildLogPayload } = require('./_shared/observability');
const { writeRequestLog, getAdminClient }       = require('./_shared/supabase');
const { exchangeCodeForToken }                  = require('./_shared/integrations/meta');
const { encrypt }                               = require('./_shared/crypto');
const { writeAudit }                            = require('./_shared/audit');

const resolveAppUrl = () => process.env.APP_URL || process.env.URL || '';
const REDIRECT_URI  = () => `${resolveAppUrl()}/.netlify/functions/oauth-callback-meta`;

exports.handler = async (event) => {
  const context    = createRequestContext(event, 'oauth-callback-meta');
  const params     = event.queryStringParameters || {};
  const code       = params.code;
  const state      = params.state;
  const errorParam = params.error;
  const appUrl     = resolveAppUrl();

  // Diagnostic log — visible in Netlify Function Logs
  console.log('[oauth-meta] incoming', {
    method:    event.httpMethod,
    appUrl,
    hasCode:   !!code,
    hasState:  !!state,
    hasError:  !!errorParam,
    allParams: Object.keys(params),
    REDIRECT_URI: REDIRECT_URI(),
  });

  // Early env var check — fail fast with a clear error instead of a generic exchange failure
  if (!process.env.META_APP_ID || !process.env.META_APP_SECRET) {
    console.error('[oauth-meta] Missing required env vars: META_APP_ID and/or META_APP_SECRET. Set them in Netlify environment variables.');
    return redirect(`${appUrl}/?error=meta_not_configured`);
  }

  if (errorParam) {
    await writeRequestLog(buildLogPayload(context, 'warn', 'meta_oauth_denied', { error: errorParam }));
    return redirect(`${appUrl}/settings/integrations?error=meta_denied`);
  }

  if (!code || !state) {
    await writeRequestLog(buildLogPayload(context, 'warn', 'meta_oauth_missing_params', {
      hasCode: !!code, hasState: !!state, allParams: Object.keys(params),
    }));
    return redirect(`${appUrl}/settings/integrations?error=meta_missing_params`);
  }

  let userId;
  let nonce;
  try {
    const decoded  = Buffer.from(state, 'base64url').toString('utf8');
    const stateObj = JSON.parse(decoded);
    userId = stateObj.userId;
    nonce  = stateObj.nonce;
  } catch {
    return redirect(`${appUrl}/settings/integrations?error=meta_invalid_state`);
  }

  // CSRF nonce validation — consume from DB (must exist and not be expired)
  if (nonce) {
    const sb = getAdminClient();
    const { data: nonceRow } = await sb
      .from('oauth_nonces')
      .select('nonce, expires_at')
      .eq('nonce', nonce)
      .eq('user_id', userId)
      .eq('provider', 'meta')
      .maybeSingle();

    if (!nonceRow || new Date(nonceRow.expires_at) < new Date()) {
      await writeRequestLog(buildLogPayload(context, 'warn', 'meta_oauth_invalid_nonce', { user_id: userId }));
      return redirect(`${appUrl}/settings/integrations?error=meta_invalid_state`);
    }
    await getAdminClient().from('oauth_nonces').delete().eq('nonce', nonce);
  }

  try {
    const { accessToken, expiresIn } = await exchangeCodeForToken(code, REDIRECT_URI());

    // Check which scopes Meta actually granted
    let grantedScopes = [];
    try {
      const permRes  = await fetch(`https://graph.facebook.com/v19.0/me/permissions?access_token=${accessToken}`);
      const permJson = await permRes.json();
      grantedScopes  = (permJson.data || []).filter(p => p.status === 'granted').map(p => p.permission);
    } catch (e) {
      console.warn('[oauth-meta] Could not fetch granted scopes:', e.message);
    }

    const hasWriteAccess = grantedScopes.includes('ads_management') || grantedScopes.includes('business_management');

    const secret    = { accessToken, expiresIn, obtainedAt: Date.now(), grantedScopes };
    const encrypted = encrypt(JSON.stringify(secret));

    const sb = getAdminClient();
    const { error } = await sb.from('user_integrations').upsert({
      user_id:           userId,
      provider:          'meta',
      secret_ciphertext: encrypted.ciphertext,
      secret_iv:         encrypted.iv,
      secret_tag:        encrypted.tag,
      granted_scopes:    grantedScopes,
      has_write_access:  hasWriteAccess,
      updated_at:        new Date().toISOString(),
    }, { onConflict: 'user_id,provider' });

    if (error) {
      console.error('[oauth-meta] upsert error:', error.message);
      return redirect(`${appUrl}/settings/integrations?error=meta_save_failed`);
    }

    await writeAudit({ userId, action: 'integration.connect', targetType: 'provider', targetId: 'meta', ip: context.ip, requestId: context.requestId });
    await writeRequestLog(buildLogPayload(context, 'info', 'meta_oauth_connected', { user_id: userId, hasWriteAccess, scopeCount: grantedScopes.length }));

    // setup=ready → frontend will trigger meta-setup automatically (pixel creation etc.)
    // setup=readonly → app not approved yet, only read access
    const setupParam = hasWriteAccess ? '&setup=ready' : '&setup=readonly';
    return redirect(`${appUrl}/settings/integrations?connected=meta${setupParam}`);
  } catch (err) {
    console.error('[oauth-meta] error:', err.message);
    await writeRequestLog(buildLogPayload(context, 'error', 'meta_oauth_failed', { user_id: userId, error: err.message }));
    return redirect(`${appUrl}/settings/integrations?error=meta_exchange_failed`);
  }
};

function redirect(url) {
  return { statusCode: 302, headers: { Location: url }, body: '' };
}
