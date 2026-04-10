/**
 * get-ads-data.js — Fetch live ad/analytics data using the user's own OAuth tokens
 *
 * POST /get-ads-data
 * Headers: Authorization: Bearer <supabase-access-token>
 * Body: {
 *   provider:    'google_ads' | 'ga4' | 'meta'
 *   startDate?:  'YYYY-MM-DD'              (google_ads / ga4)
 *   endDate?:    'YYYY-MM-DD'              (google_ads / ga4)
 *   datePreset?: 'last_7d'|'last_30d'|...  (meta)
 *   customerId?: string                    (google_ads — override stored account_id)
 *   propertyId?: string                    (ga4 — override stored property_id)
 *   accountId?:  string                    (meta — override stored account_id)
 *   forceRefresh?: boolean                 (skip cache)
 * }
 *
 * Returns: { ok: true, data: { provider, metrics: [...], fetchedAt, cached } }
 *
 * Security:
 *   - Requires a valid user JWT (requireAuth)
 *   - Each user's tokens are stored encrypted with AES-256-GCM and never shared
 *   - RLS on user_integrations ensures one user cannot touch another's row
 *   - API keys (developer tokens, app secrets) stay server-side in env vars only
 */

'use strict';

const { ok, fail, options }                     = require('./_shared/http');
const { createRequestContext, buildLogPayload } = require('./_shared/observability');
const { writeRequestLog, loadIntegration, markIntegrationSynced, markIntegrationError } = require('./_shared/supabase');
const { requireAuth }                           = require('./_shared/auth');
const { ensureFreshToken }                      = require('./_shared/token-manager');
const { AppError }                              = require('./_shared/errors');
const { parseJsonBody, requireField }           = require('./_shared/request');
const { getAdminClient }                        = require('./_shared/supabase');

const ALLOWED_PROVIDERS = ['ga4', 'google_ads', 'meta'];

// ── Cache helpers ──────────────────────────────────────────────────────────────

function makeCacheKey(userId, provider, rangeKey) {
  return `ads:${userId}:${provider}:${rangeKey}`;
}

async function readCache(userId, provider, rangeKey) {
  const cacheKey = makeCacheKey(userId, provider, rangeKey);
  const { data } = await getAdminClient()
    .from('api_cache')
    .select('payload, fresh_until, stale_until')
    .eq('cache_key', cacheKey)
    .maybeSingle();
  return data || null;
}

async function writeCache(userId, provider, rangeKey, payload) {
  const env          = require('./_shared/env').getEnv();
  const freshSeconds = env.CACHE_TTL_SECONDS         || 2700;   // 45 min
  const staleSeconds = env.STALE_CACHE_TTL_SECONDS   || 21600;  // 6 hrs
  const now          = Date.now();
  const cacheKey     = makeCacheKey(userId, provider, rangeKey);

  await getAdminClient()
    .from('api_cache')
    .upsert({
      cache_key:   cacheKey,
      user_id:     userId,
      source:      provider,
      range_preset: rangeKey,
      metric:      'all',
      payload,
      fresh_until: new Date(now + freshSeconds * 1000).toISOString(),
      stale_until: new Date(now + staleSeconds * 1000).toISOString(),
      updated_at:  new Date().toISOString(),
    }, { onConflict: 'cache_key' })
    .catch(e => console.warn('[get-ads-data] cache write failed:', e.message));
}

// ── Provider fetch dispatchers ─────────────────────────────────────────────────

async function fetchGoogleAds(integration, body) {
  const { fetchCampaignMetrics, listAccessibleCustomers } = require('./_shared/integrations/google-ads');
  const { secret } = integration;
  const accessToken = secret?.accessToken;

  if (!accessToken) {
    throw new AppError({ code: 'NO_TOKEN', userMessage: 'חיבור Google Ads פג — חבר מחדש', devMessage: 'accessToken missing', status: 401 });
  }

  // Resolve customer ID: body override → stored account_id → first accessible customer
  let customerId = body.customerId || integration.account_id;
  if (!customerId) {
    const ids = await listAccessibleCustomers(accessToken);
    if (!ids.length) throw new AppError({ code: 'NO_CUSTOMERS', userMessage: 'לא נמצאו חשבונות Google Ads', devMessage: 'listAccessibleCustomers returned empty', status: 404 });
    customerId = ids[0];
  }

  const metrics = await fetchCampaignMetrics({
    customerId,
    accessToken,
    loginCustomerId: integration.metadata?.loginCustomerId || null,
    startDate:       body.startDate,
    endDate:         body.endDate,
  });

  return { metrics, accountId: customerId };
}

async function fetchGA4(integration, body) {
  const { fetchCampaignMetrics, listProperties } = require('./_shared/integrations/ga4');
  const { secret } = integration;
  const accessToken = secret?.accessToken;

  if (!accessToken) {
    throw new AppError({ code: 'NO_TOKEN', userMessage: 'חיבור GA4 פג — חבר מחדש', devMessage: 'accessToken missing', status: 401 });
  }

  // Resolve property ID: body override → stored property_id → first accessible property
  let propertyId = body.propertyId || integration.property_id;
  if (!propertyId) {
    const props = await listProperties(accessToken);
    if (!props.length) throw new AppError({ code: 'NO_PROPERTIES', userMessage: 'לא נמצאו נכסי GA4', devMessage: 'listProperties returned empty', status: 404 });
    propertyId = props[0].propertyId;
  }

  const result = await fetchCampaignMetrics({
    accessToken,
    propertyId,
    startDate: body.startDate,
    endDate:   body.endDate,
  });

  return { metrics: result.rows, rowCount: result.rowCount, propertyId };
}

async function fetchMeta(integration, body) {
  const { fetchCampaignInsights, listAdAccounts } = require('./_shared/integrations/meta');
  const { secret } = integration;
  const accessToken = secret?.accessToken;

  if (!accessToken) {
    throw new AppError({ code: 'NO_TOKEN', userMessage: 'חיבור Meta פג — חבר מחדש', devMessage: 'accessToken missing', status: 401 });
  }

  // Resolve ad account: body override → stored account_id → first accessible account
  let accountId = body.accountId || integration.account_id;
  if (!accountId) {
    const accounts = await listAdAccounts(accessToken);
    if (!accounts.length) throw new AppError({ code: 'NO_AD_ACCOUNTS', userMessage: 'לא נמצאו חשבונות Meta Ads', devMessage: 'listAdAccounts returned empty', status: 404 });
    accountId = accounts[0].accountId;
  }

  const metrics = await fetchCampaignInsights({
    accessToken,
    accountId,
    datePreset: body.datePreset || 'last_30d',
  });

  return { metrics, accountId };
}

// ── Handler ────────────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options();
  const context = createRequestContext(event, 'get-ads-data');

  try {
    if (event.httpMethod !== 'POST') {
      throw new AppError({ code: 'METHOD_NOT_ALLOWED', userMessage: 'Method not allowed', devMessage: 'Use POST', status: 405 });
    }

    // 1. Authenticate — validates JWT, rate-limits
    const user = await requireAuth(event, context.functionName, context);

    // 2. Parse request body
    const body     = parseJsonBody(event, { fallback: {}, allowEmpty: false, devMessage: 'Missing request body' });
    const provider = requireField(body.provider, 'provider');

    if (!ALLOWED_PROVIDERS.includes(provider)) {
      throw new AppError({ code: 'BAD_REQUEST', userMessage: `provider לא חוקי: ${provider}`, devMessage: `Unknown provider: ${provider}`, status: 400 });
    }

    // 3. Cache key = provider + date range
    const rangeKey    = body.datePreset || `${body.startDate || '30d'}:${body.endDate || 'today'}`;
    const forceRefresh = body.forceRefresh === true;

    // 4. Check cache (skip on forceRefresh)
    if (!forceRefresh) {
      const cached = await readCache(user.id, provider, rangeKey);
      if (cached && new Date(cached.fresh_until) > new Date()) {
        await writeRequestLog(buildLogPayload(context, 'info', 'get_ads_data_cache_hit', { user_id: user.id, provider }));
        return ok({ provider, ...cached.payload, cached: true }, context.requestId);
      }
    }

    // 5. Load integration (decrypted) — user-specific OAuth token
    let integration = await loadIntegration(user.id, provider);
    if (!integration) {
      throw new AppError({ code: 'NOT_CONNECTED', userMessage: `${provider} לא מחובר`, devMessage: `No integration found for user=${user.id} provider=${provider}`, status: 404 });
    }
    if (!integration.secret) {
      throw new AppError({ code: 'DECRYPT_FAILED', userMessage: 'שגיאת הצפנה — חבר מחדש', devMessage: 'Failed to decrypt integration secret', status: 500 });
    }

    // 6. Proactively refresh token if near expiry (5 min buffer)
    integration = await ensureFreshToken(user.id, integration);

    // 7. Fetch live data from the provider API
    let providerResult;
    try {
      if (provider === 'google_ads') {
        providerResult = await fetchGoogleAds(integration, body);
      } else if (provider === 'ga4') {
        providerResult = await fetchGA4(integration, body);
      } else if (provider === 'meta') {
        providerResult = await fetchMeta(integration, body);
      }
    } catch (apiErr) {
      // Mark integration as errored in DB (non-blocking)
      await markIntegrationError(user.id, provider, apiErr.devMessage || apiErr.message);
      throw apiErr;
    }

    // 8. Mark as synced + compute token expiry for status display
    const secret = integration.secret;
    const expiresAt = secret?.obtainedAt && secret?.expiresIn
      ? new Date(secret.obtainedAt + Number(secret.expiresIn) * 1000).toISOString()
      : null;
    await markIntegrationSynced(user.id, provider, {
      expiresAt,
      accountName: providerResult.accountId || providerResult.propertyId || null,
    });

    // 9. Build response payload + write to cache
    const fetchedAt = new Date().toISOString();
    const payload   = { ...providerResult, fetchedAt };

    await writeCache(user.id, provider, rangeKey, payload);
    await writeRequestLog(buildLogPayload(context, 'info', 'get_ads_data_fetched', {
      user_id:      user.id,
      provider,
      metric_count: Array.isArray(providerResult.metrics) ? providerResult.metrics.length : 0,
    }));

    return ok({ provider, ...payload, cached: false }, context.requestId);

  } catch (error) {
    await writeRequestLog(buildLogPayload(context, 'error', error.message || 'get_ads_data_failed', {
      code: error.code || 'INTERNAL_ERROR',
    })).catch(() => {});
    return fail(error, context.requestId);
  }
};
