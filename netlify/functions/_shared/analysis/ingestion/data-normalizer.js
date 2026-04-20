'use strict';
/**
 * analysis/ingestion/data-normalizer.js
 * Normalises raw multi-provider data into a single unified schema.
 * Also runs data-integrity checks: duplicates, missing fields, anomalies, fake-lead signals.
 */

const UNIFIED_SCHEMA_KEYS = [
  'campaign_id', 'platform', 'date',
  'impressions', 'clicks', 'ctr',
  'cpc', 'conversions', 'conversion_rate',
  'cost', 'revenue', 'engagement',
  'followers', 'reach', 'frequency',
];

/**
 * Normalize a single provider's data row into the unified schema.
 * @param {object} raw   — provider-specific row
 * @param {string} platform  — 'google_ads' | 'meta' | 'ga4' | 'tiktok' | ...
 */
function normalizeRow(raw, platform) {
  const impressions  = _n(raw.impressions);
  const clicks       = _n(raw.clicks);
  const cost         = _n(raw.spend || raw.cost);
  const conversions  = _n(raw.conversions || raw.leads || raw.purchases);
  const revenue      = _n(raw.revenue || raw.conversionsValue);
  const engagement   = _n(raw.engagement || raw.reactions || raw.likes);
  const reach        = _n(raw.reach);
  const frequency    = _n(raw.frequency);
  const followers    = _n(raw.followers || raw.followerCount);

  return {
    campaign_id:      raw.campaign_id || raw.campaignId || raw.id || null,
    platform,
    date:             raw.date || raw.dateRange || null,
    impressions,
    clicks,
    ctr:              impressions > 0 ? _round(clicks / impressions, 4) : 0,
    cpc:              clicks > 0 ? _round(cost / clicks, 2) : 0,
    conversions,
    conversion_rate:  clicks > 0 ? _round(conversions / clicks, 4) : 0,
    cost:             _round(cost, 2),
    revenue:          _round(revenue, 2),
    engagement,
    followers,
    reach,
    frequency,
    roas:             cost > 0 ? _round(revenue / cost, 2) : 0,
    cpa:              conversions > 0 ? _round(cost / conversions, 2) : null,
  };
}

/**
 * Merge multiple provider snapshots into a single unified object.
 * @param {object} providers — { google_ads, ga4, meta, tiktok, ... }
 * @returns {{ unified, byPlatform, integrity }}
 */
function normalizeProviders(providers) {
  const byPlatform = {};
  const rows = [];

  for (const [platform, data] of Object.entries(providers)) {
    if (!data) continue;

    // Handle aggregated totals or arrays of campaign rows
    const rawRows = Array.isArray(data.campaigns) ? data.campaigns
      : Array.isArray(data.rows) ? data.rows
      : [data.totals || data];

    const normalized = rawRows.map(r => normalizeRow(r, platform));
    byPlatform[platform] = normalized;
    rows.push(...normalized);
  }

  const unified = _aggregateRows(rows);
  const integrity = runIntegrityChecks(unified, rows, providers);

  return { unified, byPlatform, rows, integrity };
}

function _aggregateRows(rows) {
  if (!rows.length) return normalizeRow({}, 'none');

  const agg = rows.reduce((acc, r) => ({
    impressions: acc.impressions + r.impressions,
    clicks:      acc.clicks      + r.clicks,
    conversions: acc.conversions + r.conversions,
    cost:        acc.cost        + r.cost,
    revenue:     acc.revenue     + r.revenue,
    engagement:  acc.engagement  + r.engagement,
    followers:   acc.followers   + r.followers,
    reach:       acc.reach       + r.reach,
  }), { impressions: 0, clicks: 0, conversions: 0, cost: 0, revenue: 0, engagement: 0, followers: 0, reach: 0 });

  return {
    platform:        'aggregated',
    impressions:     agg.impressions,
    clicks:          agg.clicks,
    ctr:             agg.impressions > 0 ? _round(agg.clicks / agg.impressions, 4) : 0,
    cpc:             agg.clicks > 0 ? _round(agg.cost / agg.clicks, 2) : 0,
    conversions:     agg.conversions,
    conversion_rate: agg.clicks > 0 ? _round(agg.conversions / agg.clicks, 4) : 0,
    cost:            _round(agg.cost, 2),
    revenue:         _round(agg.revenue, 2),
    engagement:      agg.engagement,
    followers:       agg.followers,
    reach:           agg.reach,
    roas:            agg.cost > 0 ? _round(agg.revenue / agg.cost, 2) : 0,
    cpa:             agg.conversions > 0 ? _round(agg.cost / agg.conversions, 2) : null,
  };
}

// ── Integrity Checks ───────────────────────────────────────────────────────────

function runIntegrityChecks(unified, rows, providers) {
  const warnings = [];
  const errors   = [];

  // Missing data
  if (unified.impressions === 0 && unified.clicks === 0) {
    errors.push({ code: 'no_data', message: 'אין נתוני פרסום — בדוק חיבורי אינטגרציה' });
  }

  // Clicks > impressions (impossible)
  if (unified.clicks > unified.impressions && unified.impressions > 0) {
    errors.push({ code: 'clicks_exceed_impressions', message: `קליקים (${unified.clicks}) עולים על חשיפות (${unified.impressions})` });
  }

  // CTR anomaly — > 30% is suspicious
  if (unified.ctr > 0.30) {
    warnings.push({ code: 'suspicious_ctr', message: `CTR חריג (${(unified.ctr * 100).toFixed(1)}%) — ייתכן bot traffic` });
  }

  // Fake leads signal — conversions >> expected based on traffic
  if (unified.conversion_rate > 0.50 && unified.clicks > 100) {
    warnings.push({ code: 'suspicious_conversion_rate', message: `שיעור המרה חשוד (${(unified.conversion_rate * 100).toFixed(1)}%) — בדוק פיקסל tracking` });
  }

  // Revenue without conversions
  if (unified.revenue > 0 && unified.conversions === 0) {
    warnings.push({ code: 'revenue_without_conversions', message: 'הכנסות ללא המרות — הגדרת המרות לא תואמת' });
  }

  // Duplicate platform data
  const platforms = Object.keys(providers).filter(k => providers[k]);
  const seen = new Set(platforms);
  if (seen.size < platforms.length) {
    warnings.push({ code: 'duplicate_platforms', message: 'מקורות כפולים זוהו — נתונים עשויים להיספר פעמיים' });
  }

  // Missing key fields per platform
  for (const [platform, data] of Object.entries(providers)) {
    if (data && !data.totals && !data.campaigns && !data.rows) {
      warnings.push({ code: `missing_totals_${platform}`, message: `חסרים נתוני סה"כ מ-${platform}` });
    }
  }

  return {
    passed:   errors.length === 0,
    errors,
    warnings,
    score:    errors.length === 0 ? (warnings.length === 0 ? 100 : 80) : 40,
  };
}

function _n(v) { return typeof v === 'number' && isFinite(v) ? v : 0; }
function _round(v, d) { return Math.round(v * Math.pow(10, d)) / Math.pow(10, d); }

module.exports = { normalizeProviders, normalizeRow, runIntegrityChecks, UNIFIED_SCHEMA_KEYS };
