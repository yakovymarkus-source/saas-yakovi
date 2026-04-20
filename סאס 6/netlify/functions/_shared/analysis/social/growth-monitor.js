'use strict';
/**
 * analysis/social/growth-monitor.js
 * Tracks social platform growth: followers, content performance, growth source analysis.
 * Works with Meta, TikTok, Instagram data from the normalizer.
 */

/**
 * @param {object} byPlatform  — per-platform normalized rows from data-normalizer
 * @param {object} previous    — previous period byPlatform (optional)
 * @returns {{ platforms, combined, trends, alerts }}
 */
function monitorSocialGrowth(byPlatform, previous = null) {
  const platforms = {};
  const alerts    = [];

  for (const [platform, rows] of Object.entries(byPlatform || {})) {
    if (!_isSocialPlatform(platform)) continue;
    const current  = _aggregateSocial(rows);
    const prev     = previous?.[platform] ? _aggregateSocial(previous[platform]) : null;
    const analysis = _analyzePlatformGrowth(platform, current, prev);
    platforms[platform] = analysis;
    alerts.push(...analysis.alerts);
  }

  const combined = _combinedSocialSummary(platforms);

  return { platforms, combined, alerts, has_social_data: Object.keys(platforms).length > 0 };
}

function _isSocialPlatform(p) {
  return ['meta', 'instagram', 'tiktok', 'facebook'].includes(p);
}

function _aggregateSocial(rows) {
  if (!rows || !rows.length) return null;
  return rows.reduce((acc, r) => ({
    impressions: acc.impressions + (r.impressions || 0),
    clicks:      acc.clicks      + (r.clicks      || 0),
    engagement:  acc.engagement  + (r.engagement  || 0),
    followers:   Math.max(acc.followers, r.followers || 0), // take max (not sum) for follower count
    reach:       acc.reach       + (r.reach       || 0),
    cost:        acc.cost        + (r.cost        || 0),
  }), { impressions: 0, clicks: 0, engagement: 0, followers: 0, reach: 0, cost: 0 });
}

function _analyzePlatformGrowth(platform, current, prev) {
  if (!current) return { platform, status: 'no_data', alerts: [] };

  const engagementRate = current.impressions > 0
    ? _round(current.engagement / current.impressions, 4)
    : 0;

  const alerts = [];

  // Growth rate
  let followerGrowthPct = null;
  let followerTrend     = 'no_data';
  if (prev && prev.followers > 0 && current.followers > 0) {
    followerGrowthPct = _round(((current.followers - prev.followers) / prev.followers) * 100, 1);
    followerTrend     = followerGrowthPct >= 5 ? 'growing' : followerGrowthPct >= 0 ? 'stable' : 'declining';
    if (followerTrend === 'declining') {
      alerts.push({
        platform,
        code:     'follower_decline',
        severity: 'medium',
        message:  `ב-${platform} אבדו ${Math.abs(followerGrowthPct)}% מהעוקבים`,
        action:   'בחן תוכן שגרם לביטולי עוקבים',
      });
    }
  }

  // Engagement health
  const engBenchmarks = { meta: 0.02, instagram: 0.04, tiktok: 0.06, facebook: 0.015 };
  const benchmark     = engBenchmarks[platform] || 0.02;
  const engStatus     = engagementRate >= benchmark * 1.5 ? 'excellent'
    : engagementRate >= benchmark       ? 'good'
    : engagementRate >= benchmark * 0.5 ? 'below_average'
    : 'poor';

  if (engStatus === 'poor') {
    alerts.push({
      platform,
      code:     'low_engagement',
      severity: 'medium',
      message:  `מעורבות נמוכה ב-${platform} (${_pct(engagementRate)} מול benchmark ${_pct(benchmark)})`,
      action:   'בחן סוג תוכן, שעות פרסום, ורלוונטיות לקהל',
    });
  }

  // Growth source analysis
  const growthSource = _estimateGrowthSource(current, prev);

  return {
    platform,
    status:         followerTrend,
    followers:      current.followers,
    follower_growth_pct: followerGrowthPct,
    engagement_rate: engagementRate,
    engagement_status: engStatus,
    reach:          current.reach,
    paid_vs_organic: growthSource,
    alerts,
    benchmarks: {
      engagement_benchmark: benchmark,
      your_rate:            engagementRate,
      rating:               engStatus,
    },
  };
}

function _estimateGrowthSource(current, prev) {
  if (!current.cost || current.cost === 0) {
    return { source: 'organic', confidence: 0.70, note: 'אין הוצאות מודעות — גידול אורגני' };
  }
  const paidRatio = current.clicks > 0 && current.reach > 0
    ? current.clicks / current.reach
    : null;

  return {
    source:    'mixed',
    paid_cost: current.cost,
    ratio:     paidRatio ? _round(paidRatio, 3) : null,
    confidence: 0.65,
    note:       'שילוב של תנועה ממומנת ואורגנית',
  };
}

function _combinedSocialSummary(platforms) {
  const entries = Object.values(platforms).filter(p => p.status !== 'no_data');
  if (!entries.length) return { status: 'no_social_data' };

  const avgEngRate   = entries.reduce((s, p) => s + (p.engagement_rate || 0), 0) / entries.length;
  const totalFollowers = entries.reduce((s, p) => s + (p.followers || 0), 0);
  const growing      = entries.filter(p => p.status === 'growing').length;

  return {
    total_followers:        totalFollowers,
    avg_engagement_rate:    _round(avgEngRate, 4),
    platforms_growing:      growing,
    platforms_total:        entries.length,
    overall_social_health:  growing >= entries.length * 0.6 ? 'healthy' : 'needs_attention',
  };
}

function _pct(v) { return `${(v * 100).toFixed(2)}%`; }
function _round(v, d) { return Math.round(v * Math.pow(10, d)) / Math.pow(10, d); }

module.exports = { monitorSocialGrowth };
