'use strict';

/**
 * get-economics.js
 *
 * GET — load business profile + aggregate metrics → run revenue-calculator → return results
 *
 * Optional query params:
 *   ?close_rate=0.3   — lead-to-sale close rate (default 1.0)
 *   ?target_revenue=50000 — monthly revenue goal for funnel simulation
 */

const { ok, fail, options }    = require('./_shared/http');
const { createRequestContext } = require('./_shared/observability');
const { requireAuth }          = require('./_shared/auth');
const { getAdminClient }       = require('./_shared/supabase');
const { AppError }             = require('./_shared/errors');
const {
  computeUnitEconomics,
  computeFunnelEconomics,
  simulateLaunch,
  cplStatusLabel,
  roasLabel,
} = require('./_shared/revenue-calculator');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options();
  if (event.httpMethod !== 'GET') {
    return fail(new AppError({ code: 'METHOD_NOT_ALLOWED', userMessage: 'Use GET', status: 405 }));
  }

  const ctx = createRequestContext(event, 'get-economics');

  try {
    const user = await requireAuth(event, 'get-economics', ctx);
    const sb   = getAdminClient();
    const q    = event.queryStringParameters || {};

    const closeRate     = Math.min(1, Math.max(0.01, parseFloat(q.close_rate     || '1.0')));
    const targetRevenue = parseFloat(q.target_revenue || '0') || null;

    // Load profile + aggregate metrics in parallel
    const [profileRes, metricsRes] = await Promise.all([
      sb.from('business_profiles').select('*').eq('user_id', user.id).maybeSingle(),
      sb.from('asset_metrics').select('impressions,clicks,conversions,revenue').eq('user_id', user.id),
    ]);

    const profile = profileRes.data || null;
    const metrics = metricsRes.data || [];

    if (!profile) {
      return ok({ hasProfile: false, message: 'מלא פרופיל עסקי כדי לחשב כלכלת יחידה' }, ctx.requestId);
    }

    // Aggregate all metrics
    const agg = metrics.reduce((acc, m) => ({
      impressions: acc.impressions + (m.impressions || 0),
      clicks:      acc.clicks      + (m.clicks      || 0),
      conversions: acc.conversions + (m.conversions || 0),
      revenue:     acc.revenue     + Number(m.revenue || 0),
    }), { impressions: 0, clicks: 0, conversions: 0, revenue: 0 });

    // Derive computed metrics
    const spend   = profile.monthly_budget || 0;
    agg.ctr       = agg.impressions > 0 ? agg.clicks / agg.impressions : 0;
    agg.convRate  = agg.clicks > 0      ? agg.conversions / agg.clicks  : 0;
    agg.cpc       = agg.clicks > 0      ? spend / agg.clicks            : 0;
    agg.spend     = spend;
    agg.roas      = spend > 0 && agg.revenue > 0 ? agg.revenue / spend   : null;

    const hasLiveData = agg.clicks > 0 || agg.conversions > 0;

    // Run calculators
    const unitEcon  = computeUnitEconomics({ businessProfile: profile, liveMetrics: agg, closeRate });
    const funnelEcon = targetRevenue
      ? computeFunnelEconomics({ targetRevenue, businessProfile: profile, liveMetrics: agg, closeRate })
      : null;
    const simulation = !hasLiveData
      ? simulateLaunch({ businessProfile: profile, assumptions: { dailyBudget: spend / 30 || 50 } })
      : null;

    return ok({
      hasProfile: true,
      hasLiveData,
      profile: {
        business_name:  profile.business_name,
        price_amount:   profile.price_amount,
        pricing_model:  profile.pricing_model,
        monthly_budget: profile.monthly_budget,
        primary_goal:   profile.primary_goal,
      },
      aggregateMetrics: { ...agg, assetCount: metrics.length },
      unitEconomics: {
        ...unitEcon,
        cplStatusLabel:  cplStatusLabel(unitEcon.cplStatus),
        roasLabel:       roasLabel(unitEcon.roas),
      },
      funnelEconomics: funnelEcon,
      simulation,
      closeRate,
    }, ctx.requestId);

  } catch (err) {
    return fail(err, ctx.requestId);
  }
};
