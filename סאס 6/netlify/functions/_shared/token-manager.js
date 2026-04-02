/**
 * token-manager.js — Proactive OAuth token refresh for all integrations
 *
 * Called before every API fetch in analyze-service.js.
 * If a token is within REFRESH_BUFFER_SECONDS of expiry (or already expired),
 * it is refreshed, re-encrypted, and saved back to the DB before use.
 *
 * Provider behaviour:
 *   google_ads / ga4  — standard OAuth2 refresh_token flow (1-hour access tokens)
 *   meta              — fb_exchange_token extension (60-day long-lived tokens)
 */

'use strict';

const { getAdminClient } = require('./supabase');
const { encrypt }        = require('./crypto');
const { AppError }       = require('./errors');

// Refresh 5 minutes before actual expiry to avoid race conditions
const REFRESH_BUFFER_SECONDS = 300;

// ─── Token staleness check ────────────────────────────────────────────────────
function isTokenStale(secret, bufferSeconds = REFRESH_BUFFER_SECONDS) {
  if (!secret?.obtainedAt || !secret?.expiresIn) return false; // can't determine — assume ok
  const expiresAt = secret.obtainedAt + (Number(secret.expiresIn) * 1000);
  return Date.now() >= expiresAt - (bufferSeconds * 1000);
}

// ─── Save refreshed secret back to DB ────────────────────────────────────────
async function saveIntegrationSecret(userId, provider, newSecret) {
  const encrypted = encrypt(JSON.stringify(newSecret));
  const { error } = await getAdminClient()
    .from('user_integrations')
    .update({
      secret_ciphertext: encrypted.ciphertext,
      secret_iv:         encrypted.iv,
      secret_tag:        encrypted.tag,
      updated_at:        new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('provider', provider);

  if (error) console.error(`[token-manager] DB save failed (${provider}):`, error.message);
}

// ─── Google refresh (google_ads + ga4 share the same OAuth mechanism) ─────────
async function refreshGoogle(userId, integration) {
  const { refreshAccessToken } = require('./integrations/google-ads');
  const secret = integration.secret;

  if (!secret?.refreshToken) {
    console.warn('[token-manager] Google: no refresh_token stored — user must re-connect');
    return integration;
  }

  const { accessToken, expiresIn } = await refreshAccessToken(secret.refreshToken);

  const newSecret = {
    ...secret,
    accessToken,
    expiresIn,
    obtainedAt: Date.now(),
  };

  await saveIntegrationSecret(userId, integration.provider, newSecret);
  console.log(`[token-manager] Google token refreshed for provider=${integration.provider}`);
  return { ...integration, secret: newSecret };
}

// ─── Meta token extension (fb_exchange_token) ────────────────────────────────
async function refreshMeta(userId, integration) {
  const secret = integration.secret;
  if (!secret?.accessToken) return integration;

  const appId     = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const version   = process.env.META_GRAPH_VERSION || 'v19.0';

  if (!appId || !appSecret) {
    console.warn('[token-manager] Meta: META_APP_ID or META_APP_SECRET not configured');
    return integration;
  }

  const url = new URL(`https://graph.facebook.com/${version}/oauth/access_token`);
  url.searchParams.set('grant_type',        'fb_exchange_token');
  url.searchParams.set('client_id',         appId);
  url.searchParams.set('client_secret',     appSecret);
  url.searchParams.set('fb_exchange_token', secret.accessToken);

  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    console.warn('[token-manager] Meta token extension failed:', res.status, body?.error?.message || '');
    return integration; // return stale — let API call fail naturally and surface the error
  }

  const { access_token, expires_in } = await res.json();
  const newSecret = {
    ...secret,
    accessToken: access_token,
    expiresIn:   expires_in,
    obtainedAt:  Date.now(),
  };

  await saveIntegrationSecret(userId, 'meta', newSecret);
  console.log('[token-manager] Meta token extended successfully');
  return { ...integration, secret: newSecret };
}

// ─── Main entry point ─────────────────────────────────────────────────────────
/**
 * Ensure the integration's access token is fresh before use.
 * - Returns the integration unchanged if the token is still valid.
 * - Returns the integration with a refreshed token if it was stale.
 * - On refresh failure, logs a warning and returns the original (stale) integration
 *   so the downstream API call surfaces the auth error directly to the caller.
 *
 * @param {string} userId
 * @param {object|null} integration — result of loadIntegration(); may be null
 * @returns {object|null}
 */
async function ensureFreshToken(userId, integration) {
  if (!integration?.secret) return integration;

  if (!isTokenStale(integration.secret)) return integration;

  const { provider } = integration;
  console.log(`[token-manager] Token stale for provider=${provider}, refreshing...`);

  try {
    if (provider === 'google_ads' || provider === 'ga4') {
      return await refreshGoogle(userId, integration);
    }
    if (provider === 'meta') {
      return await refreshMeta(userId, integration);
    }
  } catch (err) {
    console.error(`[token-manager] Refresh failed for provider=${provider}:`, err.message);
    // Fall through — return stale integration; the API call will fail with a clear auth error
  }

  return integration;
}

module.exports = { ensureFreshToken, isTokenStale };
