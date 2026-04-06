/**
 * analyze-service.js — Campaign analysis engine with real multi-tenant API data
 *
 * analyzeCampaign({ userId, campaignId, query, requestId })
 *   1. Loads ALL of the user's connected integrations from the DB
 *   2. For each provider (ga4, google_ads, meta), fetches live metrics using the
 *      user's own OAuth tokens (decrypted server-side, never exposed to frontend)
 *   3. Merges metrics from all sources into a unified scoring model
 *   4. Generates decisions + actionable recommendations
 *   5. Persists everything atomically via persist_analysis_atomic RPC
 *
 * All credentials come from user_integrations — there are no hardcoded or
 * .env-level API keys used here. Each user's data is fully isolated.
 */

'use strict';

const { persistAnalysis }    = require('./persistence');
const { AppError }           = require('./errors');
const { loadAllIntegrations, markIntegrationSynced, markIntegrationError } = require('./supabase');
const { ensureFreshToken }   = require('./token-manager');

// ── Provider data fetchers ─────────────────────────────────────────────────────

async function fetchGoogleAdsMetrics(userId, integration) {
  const { fetchCampaignMetrics, listAccessibleCustomers } = require('./integrations/google-ads');
  const { secret } = integration;
  if (!secret?.accessToken) return null;

  const freshIntegration = await ensureFreshToken(userId, integration);
  const accessToken      = freshIntegration.secret?.accessToken;
  if (!accessToken) return null;

  try {
    let customerId = integration.account_id;
    if (!customerId) {
      const ids = await listAccessibleCustomers(accessToken);
      customerId = ids[0] || null;
    }
    if (!customerId) return null;

    const rows = await fetchCampaignMetrics({
      customerId,
      accessToken,
      loginCustomerId: integration.metadata?.loginCustomerId || null,
    });

    // Aggregate across all campaigns in the account
    const totals = rows.reduce((acc, r) => ({
      impressions:      acc.impressions      + r.impressions,
      clicks:           acc.clicks           + r.clicks,
      spend:            acc.spend            + r.spend,
      conversions:      acc.conversions      + r.conversions,
      conversionsValue: acc.conversionsValue + (r.conversionsValue || 0),
    }), { impressions: 0, clicks: 0, spend: 0, conversions: 0, conversionsValue: 0 });

    await markIntegrationSynced(userId, 'google_ads');
    return { source: 'google_ads', campaigns: rows, totals, accountId: customerId };
  } catch (err) {
    console.warn('[analyze] Google Ads fetch failed:', err.message);
    await markIntegrationError(userId, 'google_ads', err.message);
    return null;
  }
}

async function fetchGA4Metrics(userId, integration) {
  const { fetchCampaignMetrics, listProperties } = require('./integrations/ga4');
  const { secret } = integration;
  if (!secret?.accessToken) return null;

  const freshIntegration = await ensureFreshToken(userId, integration);
  const accessToken      = freshIntegration.secret?.accessToken;
  if (!accessToken) return null;

  try {
    let propertyId = integration.property_id;
    if (!propertyId) {
      const props = await listProperties(accessToken);
      propertyId = props[0]?.propertyId || null;
    }
    if (!propertyId) return null;

    const result = await fetchCampaignMetrics({ accessToken, propertyId });

    // Sum totals across all channel groups
    const totals = (result.rows || []).reduce((acc, r) => ({
      sessions:    acc.sessions    + (r.sessions    || 0),
      conversions: acc.conversions + (r.conversions || 0),
      revenue:     acc.revenue     + (r.totalRevenue || 0),
    }), { sessions: 0, conversions: 0, revenue: 0 });

    await markIntegrationSynced(userId, 'ga4');
    return { source: 'ga4', rows: result.rows, totals, rowCount: result.rowCount, propertyId };
  } catch (err) {
    console.warn('[analyze] GA4 fetch failed:', err.message);
    await markIntegrationError(userId, 'ga4', err.message);
    return null;
  }
}

async function fetchMetaMetrics(userId, integration) {
  const { fetchCampaignInsights, listAdAccounts } = require('./integrations/meta');
  const { secret } = integration;
  if (!secret?.accessToken) return null;

  const freshIntegration = await ensureFreshToken(userId, integration);
  const accessToken      = freshIntegration.secret?.accessToken;
  if (!accessToken) return null;

  try {
    let accountId = integration.account_id;
    if (!accountId) {
      const accounts = await listAdAccounts(accessToken);
      accountId = accounts[0]?.accountId || null;
    }
    if (!accountId) return null;

    const campaigns = await fetchCampaignInsights({ accessToken, accountId });

    const totals = campaigns.reduce((acc, r) => ({
      impressions:  acc.impressions  + r.impressions,
      clicks:       acc.clicks       + r.clicks,
      spend:        acc.spend        + r.spend,
      conversions:  acc.conversions  + r.conversions,
      reach:        acc.reach        + r.reach,
    }), { impressions: 0, clicks: 0, spend: 0, conversions: 0, reach: 0 });

    await markIntegrationSynced(userId, 'meta');
    return { source: 'meta', campaigns, totals, accountId };
  } catch (err) {
    console.warn('[analyze] Meta fetch failed:', err.message);
    await markIntegrationError(userId, 'meta', err.message);
    return null;
  }
}

// ── Metrics aggregation ────────────────────────────────────────────────────────

/**
 * Merge metrics from all available sources into a flat unified object.
 * Prioritises paid-media sources (google_ads, meta) for click/impression data,
 * and GA4 for session/conversion data when both are available.
 */
function mergeMetrics(dataBySource) {
  const ads    = dataBySource.google_ads;
  const ga4    = dataBySource.ga4;
  const meta   = dataBySource.meta;

  const impressions  = (ads?.totals?.impressions  || 0) + (meta?.totals?.impressions  || 0);
  const clicks       = (ads?.totals?.clicks       || 0) + (meta?.totals?.clicks       || 0);
  const spend        = (ads?.totals?.spend        || 0) + (meta?.totals?.spend        || 0);
  const conversions  = ga4
    ? ga4.totals.conversions
    : (ads?.totals?.conversions || 0) + (meta?.totals?.conversions || 0);
  const revenue      = ga4 ? ga4.totals.revenue : (ads?.totals?.conversionsValue || 0);
  const sessions     = ga4 ? ga4.totals.sessions : 0;

  const ctr          = impressions > 0 ? clicks / impressions : 0;
  const convRate     = clicks > 0 ? conversions / clicks : 0;
  const cpc          = clicks > 0 ? spend / clicks : 0;
  const roas         = spend > 0 ? revenue / spend : 0;

  return { impressions, clicks, spend, conversions, revenue, sessions, ctr, convRate, cpc, roas };
}

// ── Scoring model ──────────────────────────────────────────────────────────────

function scoreMetrics(metrics) {
  const { impressions, clicks, conversions, ctr, convRate, roas } = metrics;

  // Each sub-score is 0-100; weights sum to 1.0
  const trafficScore = Math.min(100, impressions > 0 ? Math.round(Math.log10(impressions + 1) * 25) : 0);
  const ctrScore     = Math.min(100, Math.round(ctr * 2000));           // 5% CTR = 100
  const convScore    = Math.min(100, Math.round(convRate * 1000));      // 10% conv = 100
  const roasScore    = Math.min(100, Math.round(Math.min(roas, 5) * 20)); // 5x ROAS = 100
  const coverageScore = (clicks > 0 ? 50 : 0) + (conversions > 0 ? 30 : 0) + (impressions > 1000 ? 20 : 0);

  const overall = Math.round(
    trafficScore    * 0.20 +
    ctrScore        * 0.25 +
    convScore       * 0.30 +
    roasScore       * 0.15 +
    coverageScore   * 0.10
  );

  return { overall, traffic: trafficScore, ctr: ctrScore, conversion: convScore, roas: roasScore, coverage: coverageScore };
}

// ── Decisions ─────────────────────────────────────────────────────────────────

function buildDecisions(metrics) {
  const { clicks, impressions, conversions, ctr, roas } = metrics;
  const decisions = [];

  if (clicks === 0 && impressions === 0) {
    decisions.push({ verdict: 'insufficient_data', reason: 'אין נתוני פרסום — בדוק חיבורי אינטגרציה', confidence: 90 });
  } else if (clicks === 0) {
    decisions.push({ verdict: 'no-traffic', reason: 'פרסומות מוצגות אך אין קליקים — בדוק יצירתיות וטרגטינג', confidence: 88 });
  } else if (conversions === 0) {
    decisions.push({ verdict: 'needs_work', reason: 'יש תנועה אך אין המרות — בדוק דף נחיתה ו-CTA', confidence: 82 });
  } else if (roas < 1) {
    decisions.push({ verdict: 'critical', reason: `ROAS נמוך (${roas.toFixed(2)}x) — ההוצאה עולה על ההכנסה`, confidence: 85 });
  } else if (ctr < 0.005) {
    decisions.push({ verdict: 'needs_work', reason: `CTR נמוך (${(ctr * 100).toFixed(2)}%) — הפרסומות לא מושכות קליקים`, confidence: 80 });
  } else {
    decisions.push({ verdict: 'healthy', reason: `ביצועים תקינים: ROAS ${roas.toFixed(2)}x, CTR ${(ctr * 100).toFixed(2)}%`, confidence: 85 });
  }

  return decisions;
}

// ── Recommendations ────────────────────────────────────────────────────────────

function buildRecommendations(metrics, scores) {
  const recs = [];
  const { clicks, impressions, conversions, ctr, convRate, roas, spend } = metrics;

  if (impressions === 0) {
    recs.push({
      issue:          'אין חשיפות',
      rootCause:      'האינטגרציה מחוברת אך אין נתונים — ייתכן שהקמפיין מושהה',
      action:         'בדוק שהקמפיין פעיל בפלטפורמת הפרסום',
      expectedImpact: 'התחלת זרימת נתונים',
      urgency:        95, effort: 20, confidence: 90, priorityScore: 95,
    });
  } else if (ctr < 0.01) {
    recs.push({
      issue:          'CTR נמוך מ-1%',
      rootCause:      'הפרסומות לא רלוונטיות מספיק לקהל היעד',
      action:         'בדוק את הטרגטינג, רענן קריאייטיב, בצע A/B לכותרות',
      expectedImpact: 'שיפור CTR ב-30-50%',
      urgency:        75, effort: 50, confidence: 82, priorityScore: 78,
    });
  }

  if (clicks > 0 && convRate < 0.01) {
    recs.push({
      issue:          'שיעור המרה נמוך מ-1%',
      rootCause:      'דף הנחיתה לא ממיר — בעיה ב-UX, מהירות, או התאמת מסרים',
      action:         'בצע בדיקת מהירות (PageSpeed), בדוק CTA, בדוק התאמת מסר מפרסומת לדף',
      expectedImpact: 'הכפלת המרות ב-2-3x',
      urgency:        85, effort: 60, confidence: 80, priorityScore: 88,
    });
  }

  if (spend > 0 && roas < 2) {
    recs.push({
      issue:          `ROAS נמוך (${roas.toFixed(2)}x)`,
      rootCause:      'עלות רכישה גבוהה יחסית לערך ההמרה',
      action:         'הפחת תקציב לקמפיינים עם ROAS < 1, הגדל לקמפיינים עם ROAS > 3',
      expectedImpact: 'שיפור ROAS ממוצע ל-3-4x',
      urgency:        80, effort: 30, confidence: 78, priorityScore: 82,
    });
  }

  if (scores.overall >= 70 && recs.length === 0) {
    recs.push({
      issue:          'ביצועים טובים — הזדמנות לסקייל',
      rootCause:      'הקמפיינים מייצרים תשואה חיובית',
      action:         'הגדל תקציב ב-20% בקמפיינים עם ROAS > 3, בחן קהלי Lookalike',
      expectedImpact: 'הגדלת נפח המרות תוך שמירת יעילות',
      urgency:        40, effort: 35, confidence: 82, priorityScore: 65,
    });
  }

  return recs;
}

// ── Bottleneck identification ──────────────────────────────────────────────────

function identifyBottlenecks(metrics, scores) {
  const bottlenecks = [];
  if (scores.traffic    < 30) bottlenecks.push('traffic');
  if (scores.ctr        < 30) bottlenecks.push('ctr');
  if (scores.conversion < 30) bottlenecks.push('conversion');
  if (scores.roas       < 30) bottlenecks.push('roas');
  return bottlenecks;
}

// ── Main entry point ───────────────────────────────────────────────────────────

/**
 * @param {string} userId     — authenticated user's UUID
 * @param {string} campaignId — campaign ID to analyse
 * @param {object} query      — optional overrides from the sync job payload
 * @param {string} requestId  — for tracing
 */
async function analyzeCampaign({ userId, campaignId, query = {}, requestId }) {
  if (!userId || !campaignId) {
    throw new AppError({ code: 'BAD_REQUEST', userMessage: 'נתוני ניתוח חסרים', devMessage: 'Missing userId or campaignId', status: 400 });
  }

  // ── 1. Load all of this user's connected integrations ──────────────────────
  const integrations = await loadAllIntegrations(userId);

  // ── 2. Fetch real data from each connected provider in parallel ────────────
  const [adsData, ga4Data, metaData] = await Promise.all([
    integrations.has('google_ads') ? fetchGoogleAdsMetrics(userId, integrations.get('google_ads')) : Promise.resolve(null),
    integrations.has('ga4')        ? fetchGA4Metrics(userId, integrations.get('ga4'))        : Promise.resolve(null),
    integrations.has('meta')       ? fetchMetaMetrics(userId, integrations.get('meta'))       : Promise.resolve(null),
  ]);

  const hasAnyData = adsData || ga4Data || metaData;

  // ── 3. Build raw snapshot ──────────────────────────────────────────────────
  const rawSnapshot = {
    source:      'multi_provider',
    providers:   { google_ads: adsData, ga4: ga4Data, meta: metaData },
    fetchedAt:   new Date().toISOString(),
    queryParams: query,
  };

  // ── 4. Merge metrics from all sources ────────────────────────────────────
  const metrics = hasAnyData
    ? mergeMetrics({ google_ads: adsData, ga4: ga4Data, meta: metaData })
    : {
        // Fallback to query payload (manual/test data) if no integrations connected
        impressions: Number(query.impressions || 0),
        clicks:      Number(query.clicks      || 0),
        spend:       Number(query.spend       || 0),
        conversions: Number(query.conversions || 0),
        revenue:     0, sessions: 0, ctr: 0, convRate: 0, cpc: 0, roas: 0,
      };

  // ── 5. Score, decide, recommend ───────────────────────────────────────────
  const scores          = scoreMetrics(metrics);
  const decisions       = buildDecisions(metrics);
  const bottlenecks     = identifyBottlenecks(metrics, scores);
  const recommendations = buildRecommendations(metrics, scores);
  const confidence      = hasAnyData ? 85 : 40;

  // ── 6. Persist everything atomically ─────────────────────────────────────
  const analysisId = await persistAnalysis({
    userId,
    campaignId,
    requestId,
    rawSnapshot,
    metrics,
    scores,
    bottlenecks,
    decisions,
    recommendations,
    confidence,
  });

  if (!analysisId) {
    throw new AppError({ code: 'DB_WRITE_FAILED', userMessage: 'שמירת הניתוח נכשלה', devMessage: 'persistAnalysis returned empty analysisId', status: 500 });
  }

  return { analysisId, scores, decisions, recommendations, metrics };
}

module.exports = { analyzeCampaign };
