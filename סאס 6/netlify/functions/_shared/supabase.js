/**
 * supabase.js — Supabase admin client + integration loader
 *
 * Exports:
 *   getAdminClient()                     — service-role Supabase client (singleton)
 *   getUserFromToken(token)              — validate JWT and return user
 *   writeRequestLog(payload)            — fire-and-forget request log insert
 *   loadIntegration(userId, provider)   — fetch + decrypt a user's integration secret
 */

'use strict';

const { createClient } = require('@supabase/supabase-js');
const { requireEnv }   = require('./env');
const { AppError }     = require('./errors');

let _adminClient = null;

// ── Admin client (service-role, bypasses RLS) ──────────────────────────────────
function getAdminClient() {
  if (global.__TEST_SUPABASE_CLIENT__) return global.__TEST_SUPABASE_CLIENT__;
  if (!_adminClient) {
    const url = requireEnv('SUPABASE_URL');
    const key = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
    _adminClient = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _adminClient;
}

// ── JWT validation ─────────────────────────────────────────────────────────────
async function getUserFromToken(token) {
  const client = getAdminClient();
  const { data: { user }, error } = await client.auth.getUser(token);
  if (error || !user) {
    throw new AppError({
      code:        'UNAUTHORIZED',
      userMessage: 'לא מורשה',
      devMessage:  error?.message || 'Invalid or expired token',
      status:      401,
    });
  }
  return user;
}

// ── Request logging (non-critical, never blocks response) ─────────────────────
async function writeRequestLog(payload) {
  try {
    const { error } = await getAdminClient().from('request_logs').insert(payload);
    if (error) throw error;
  } catch (_) {}
}

// ── Integration loader: fetch row + decrypt secret ────────────────────────────
/**
 * Load a user's integration from the DB and decrypt the stored secret.
 *
 * Returns null if the user has no integration for that provider.
 * Returns { ...row, secret: { accessToken, refreshToken?, expiresIn, obtainedAt } }
 *
 * The `secret` field is the decrypted JSON blob stored server-side.
 * It is NEVER exposed to the frontend.
 *
 * @param {string} userId   — UUID of the authenticated user
 * @param {string} provider — 'ga4' | 'google_ads' | 'meta'
 * @returns {object|null}
 */
async function loadIntegration(userId, provider) {
  const { decrypt } = require('./crypto');

  const { data, error } = await getAdminClient()
    .from('user_integrations')
    .select('id, user_id, provider, account_id, property_id, account_name, metadata, connection_status, token_expires_at, last_sync_at, last_error, secret_ciphertext, secret_iv, secret_tag')
    .eq('user_id', userId)
    .eq('provider', provider)
    .maybeSingle();

  if (error) {
    throw new AppError({
      code:        'DB_READ_FAILED',
      userMessage: 'טעינת האינטגרציה נכשלה',
      devMessage:  error.message,
      status:      500,
    });
  }

  if (!data) return null;

  let secret = null;
  try {
    secret = JSON.parse(
      decrypt({ ciphertext: data.secret_ciphertext, iv: data.secret_iv, tag: data.secret_tag })
    );
  } catch (e) {
    console.error(`[supabase] Failed to decrypt integration for user=${userId} provider=${provider}:`, e.message);
    // Return row without secret — caller should treat this as a missing/broken integration
  }

  // Strip raw cipher fields from the returned object
  const { secret_ciphertext, secret_iv, secret_tag, ...safeRow } = data;
  return { ...safeRow, secret };
}

// ── Helper: load ALL integrations for a user ──────────────────────────────────
/**
 * Returns a Map<provider, integration> for all providers the user has connected.
 * Each integration has its secret decrypted.
 */
async function loadAllIntegrations(userId) {
  const { decrypt } = require('./crypto');

  const { data, error } = await getAdminClient()
    .from('user_integrations')
    .select('id, user_id, provider, account_id, property_id, account_name, metadata, connection_status, token_expires_at, last_sync_at, secret_ciphertext, secret_iv, secret_tag')
    .eq('user_id', userId);

  if (error) {
    throw new AppError({
      code:        'DB_READ_FAILED',
      userMessage: 'טעינת האינטגרציות נכשלה',
      devMessage:  error.message,
      status:      500,
    });
  }

  const result = new Map();
  for (const row of (data || [])) {
    let secret = null;
    try {
      secret = JSON.parse(
        decrypt({ ciphertext: row.secret_ciphertext, iv: row.secret_iv, tag: row.secret_tag })
      );
    } catch (_) {}
    const { secret_ciphertext, secret_iv, secret_tag, ...safeRow } = row;
    result.set(row.provider, { ...safeRow, secret });
  }
  return result;
}

// ── Helper: mark integration synced / errored (via RPC) ───────────────────────
async function markIntegrationSynced(userId, provider, { expiresAt = null, accountName = null } = {}) {
  await getAdminClient().rpc('mark_integration_synced', {
    p_user_id:      userId,
    p_provider:     provider,
    p_expires_at:   expiresAt,
    p_account_name: accountName,
  }).catch(e => console.warn('[supabase] mark_integration_synced failed:', e.message));
}

async function markIntegrationError(userId, provider, errorMsg) {
  await getAdminClient().rpc('mark_integration_error', {
    p_user_id:  userId,
    p_provider: provider,
    p_error:    String(errorMsg).slice(0, 500),
  }).catch(e => console.warn('[supabase] mark_integration_error failed:', e.message));
}

module.exports = {
  getAdminClient,
  getUserFromToken,
  writeRequestLog,
  loadIntegration,
  loadAllIntegrations,
  markIntegrationSynced,
  markIntegrationError,
};
