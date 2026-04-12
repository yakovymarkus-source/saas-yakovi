'use strict';

/**
 * sync-performance.js
 *
 * Pulls live campaign metrics from Google Ads or Meta and writes them into
 * asset_metrics so the Performance screen has real data automatically.
 *
 * POST /sync-performance
 * Body: {
 *   provider:    'google_ads' | 'meta' | 'all'
 *   asset_id?:   uuid   — target asset; defaults to user's most recent landing page
 *   datePreset?: 'last_7d' | 'last_30d' (default) | 'this_month'
 * }
 *
 * Returns: { synced: [ { provider, asset_id, rows_written, totals } ] }
 */

const { ok, fail, options }                     = require('./_shared/http');
const { createRequestContext }                  = require('./_shared/observability');
const { requireAuth }                           = require('./_shared/auth');
const { parseJsonBody }                         = require('./_shared/request');
const { getAdminClient, loadIntegration,
        markIntegrationSynced,
        markIntegrationError }                  = require('./_shared/supabase');
const { ensureFreshToken }                      = require('./_shared/token-manager');
const { AppError }                              = require('./_shared/errors');
const { advanceOnboarding }                     = require('./_shared/product-context');

const ALLOWED_PROVIDERS = ['google_ads', 'meta'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Fetch raw metrics from each provider ──────────────────────────────────────

async function fetchFromGoogleAds(integration, datePreset) {
  const { fetchCampaignMetrics, listAccessibleCustomers } = require('./_shared/integrations/google-ads');
  const accessToken = integration.secret?.accessToken;
  if (!accessToken) {
    throw new AppError({ code: 'NO_TOKEN', userMessage: 'חיבור Google Ads פג — חבר מחדש', status: 401 });
  }

  let customerId = integration.account_id;
  if (!customerId) {
    const ids = await listAccessibleCustomers(accessToken);
    if (!ids.length) throw new AppError({ code: 'NO_CUSTOMERS', userMessage: 'לא נמצאו חשבונות Google Ads', status: 404 });
    customerId = ids[0];
  }

  // Convert datePreset to startDate/endDate for Google Ads
  const { startDate, endDate } = datePresetToRange(datePreset);
  const rows = await fetchCampaignMetrics({
    customerId,
    accessToken,
    loginCustomerId: integration.metadata?.loginCustomerId || null,
    startDate,
    endDate,
  });

  // Aggregate across all campaigns
  return rows.reduce((acc, r) => ({
    impressions: acc.impressions + (r.impressions || 0),
    clicks:      acc.clicks      + (r.clicks      || 0),
    conversions: acc.conversions + (r.conversions || 0),
    revenue:     acc.revenue     + (r.conversions || 0) * 0, // revenue not in ads data
    spend:       acc.spend       + (r.cost        || 0),
  }), { impressions: 0, clicks: 0, conversions: 0, revenue: 0, spend: 0 });
}

async function fetchFromMeta(integration, datePreset) {
  const { fetchCampaignInsights, listAdAccounts } = require('./_shared/integrations/meta');
  const accessToken = integration.secret?.accessToken;
  if (!accessToken) {
    throw new AppError({ code: 'NO_TOKEN', userMessage: 'חיבור Meta פג — חבר מחדש', status: 401 });
  }

  let accountId = integration.account_id;
  if (!accountId) {
    const accounts = await listAdAccounts(accessToken);
    if (!accounts.length) throw new AppError({ code: 'NO_AD_ACCOUNTS', userMessage: 'לא נמצאו חשבונות Meta Ads', status: 404 });
    accountId = accounts[0].accountId;
  }

  const rows = await fetchCampaignInsights({ accessToken, accountId, datePreset: datePreset || 'last_30d' });

  return rows.reduce((acc, r) => ({
    impressions: acc.impressions + (r.impressions || 0),
    clicks:      acc.clicks      + (r.clicks      || 0),
    conversions: acc.conversions + (r.conversions || 0),
    revenue:     acc.revenue     + 0,
    spend:       acc.spend       + (r.spend       || 0),
  }), { impressions: 0, clicks: 0, conversions: 0, revenue: 0, spend: 0 });
}

// ── Date range helper ─────────────────────────────────────────────────────────

function datePresetToRange(preset) {
  const today = new Date();
  const fmt = d => d.toISOString().slice(0, 10);
  if (preset === 'last_7d') {
    const s = new Date(today); s.setDate(s.getDate() - 7);
    return { startDate: fmt(s), endDate: fmt(today) };
  }
  if (preset === 'this_month') {
    const s = new Date(today.getFullYear(), today.getMonth(), 1);
    return { startDate: fmt(s), endDate: fmt(today) };
  }
  // default: last_30d
  const s = new Date(today); s.setDate(s.getDate() - 30);
  return { startDate: fmt(s), endDate: fmt(today) };
}

// ── Handler ───────────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options();
  if (event.httpMethod !== 'POST') {
    return fail(new AppError({ code: 'METHOD_NOT_ALLOWED', userMessage: 'Use POST', status: 405 }));
  }

  const ctx = createRequestContext(event, 'sync-performance');

  try {
    const user = await requireAuth(event, 'sync-performance', ctx);
    const sb   = getAdminClient();
    const body = parseJsonBody(event, { fallback: {}, allowEmpty: true });

    const datePreset = ['last_7d', 'last_30d', 'this_month'].includes(body.datePreset)
      ? body.datePreset : 'last_30d';

    const requestedProviders = body.provider === 'all'
      ? ALLOWED_PROVIDERS
      : [body.provider].filter(p => ALLOWED_PROVIDERS.includes(p));

    if (!requestedProviders.length) {
      throw new AppError({ code: 'BAD_REQUEST', userMessage: 'provider חייב להיות google_ads, meta, או all', status: 400 });
    }

    // Resolve target asset_id — explicit or fallback to most recent landing page
    let assetId = body.asset_id && UUID_RE.test(body.asset_id) ? body.asset_id : null;
    if (!assetId) {
      const { data: latestAsset } = await sb
        .from('generated_assets')
        .select('id')
        .eq('user_id', user.id)
        .eq('asset_type', 'landing_page')
        .neq('status', 'archived')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      // If no landing page, fall back to any asset
      if (!latestAsset) {
        const { data: anyAsset } = await sb
          .from('generated_assets')
          .select('id')
          .eq('user_id', user.id)
          .neq('status', 'archived')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!anyAsset) {
          throw new AppError({ code: 'NOT_FOUND', userMessage: 'אין assets — צור דף נחיתה תחילה', status: 404 });
        }
        assetId = anyAsset.id;
      } else {
        assetId = latestAsset.id;
      }
    } else {
      // Verify ownership
      const { data: owned } = await sb
        .from('generated_assets')
        .select('id')
        .eq('id', assetId)
        .eq('user_id', user.id)
        .maybeSingle();
      if (!owned) throw new AppError({ code: 'NOT_FOUND', userMessage: 'Asset לא נמצא', status: 404 });
    }

    // Sync each provider
    const synced = [];
    for (const provider of requestedProviders) {
      let integration;
      try {
        integration = await loadIntegration(user.id, provider);
      } catch (_) {
        synced.push({ provider, skipped: true, reason: 'not_connected' });
        continue;
      }

      if (!integration) {
        synced.push({ provider, skipped: true, reason: 'not_connected' });
        continue;
      }

      // Refresh token if near expiry
      try {
        integration = await ensureFreshToken(user.id, integration);
      } catch (_) {
        // Continue with existing token
      }

      let totals;
      try {
        if (provider === 'google_ads') {
          totals = await fetchFromGoogleAds(integration, datePreset);
        } else if (provider === 'meta') {
          totals = await fetchFromMeta(integration, datePreset);
        }
      } catch (apiErr) {
        await markIntegrationError(user.id, provider, apiErr.devMessage || apiErr.message);
        synced.push({ provider, skipped: true, reason: 'api_error', error: apiErr.userMessage });
        continue;
      }

      // Write to asset_metrics
      const { data: inserted, error: insErr } = await sb
        .from('asset_metrics')
        .insert({
          asset_id:    assetId,
          user_id:     user.id,
          impressions: Math.round(totals.impressions),
          clicks:      Math.round(totals.clicks),
          conversions: Math.round(totals.conversions),
          revenue:     totals.revenue,
          source:      provider,
        })
        .select('id')
        .single();

      if (insErr) {
        synced.push({ provider, skipped: true, reason: 'db_error', error: insErr.message });
        continue;
      }

      await markIntegrationSynced(user.id, provider, {});

      synced.push({
        provider,
        asset_id:     assetId,
        metric_id:    inserted.id,
        rows_written: 1,
        totals: {
          impressions: totals.impressions,
          clicks:      totals.clicks,
          conversions: totals.conversions,
          spend:       totals.spend,
        },
      });
    }

    // Advance onboarding if any metrics were written
    const wrote = synced.some(s => !s.skipped);
    if (wrote) {
      advanceOnboarding(user.id, sb, 'has_metrics').catch(() => {});
    }

    return ok({ synced, assetId }, ctx.requestId);

  } catch (err) {
    return fail(err, ctx.requestId);
  }
};
