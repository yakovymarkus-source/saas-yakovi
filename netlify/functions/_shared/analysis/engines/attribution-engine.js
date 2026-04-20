'use strict';
/**
 * analysis/engines/attribution-engine.js
 * Determines which touchpoint gets credit for a conversion.
 * Models: first-touch, last-touch, linear, time-decay, data-driven estimate.
 * Also provides performance benchmarks vs other campaigns / periods.
 */

/**
 * @param {object} unified       — unified metrics
 * @param {object} byPlatform    — per-platform data
 * @param {object[]} history     — previous periods for benchmarking
 * @param {object} context       — { goal, industry }
 * @returns {{ attribution, benchmarks, topChannel, summary }}
 */
function runAttribution(unified, byPlatform = {}, history = [], context = {}) {
  const attribution = _calcAttribution(byPlatform, unified);
  const benchmarks  = _buildBenchmarks(unified, history, context);
  const topChannel  = _findTopChannel(attribution);
  const summary     = _buildAttributionSummary(attribution, topChannel, benchmarks);

  return { attribution, benchmarks, top_channel: topChannel, summary };
}

// ── Attribution models ─────────────────────────────────────────────────────────

function _calcAttribution(byPlatform, unified) {
  const platforms = Object.keys(byPlatform).filter(p => byPlatform[p]);
  if (!platforms.length) return { model: 'none', channels: [], note: 'אין נתונים לפי פלטפורמה' };

  const totalConv = unified.conversions || 1;

  // Estimate each platform's contribution by its share of clicks
  const channels = platforms.map(platform => {
    const rows    = byPlatform[platform] || [];
    const agg     = _aggRows(rows);
    const clickShare = unified.clicks > 0 ? (agg.clicks || 0) / unified.clicks : 0;
    const convShare  = unified.conversions > 0 ? (agg.conversions || 0) / unified.conversions : 0;

    // Models
    const firstTouch   = clickShare;   // assumes platform starts the journey
    const lastTouch    = convShare;    // direct conversion attribution
    const linear       = (firstTouch + lastTouch) / 2;
    const timeDecay    = lastTouch * 0.7 + firstTouch * 0.3; // recency bias

    return {
      platform,
      clicks:         agg.clicks || 0,
      conversions:    agg.conversions || 0,
      cost:           agg.cost || 0,
      click_share:    _round(clickShare, 3),
      first_touch:    _round(firstTouch, 3),
      last_touch:     _round(lastTouch, 3),
      linear:         _round(linear, 3),
      time_decay:     _round(timeDecay, 3),
      roas:           agg.cost > 0 ? _round(agg.revenue / agg.cost, 2) : null,
      efficiency:     agg.cost > 0 && agg.conversions > 0 ? _round(agg.cost / agg.conversions, 2) : null,
    };
  });

  channels.sort((a, b) => b.linear - a.linear);

  return {
    model:    'multi_touch_estimate',
    channels,
    note:     'ייחוס מוערך — מבוסס על חלוקת קליקים והמרות לפי פלטפורמה',
  };
}

// ── Benchmarks ─────────────────────────────────────────────────────────────────

const INDUSTRY_BENCHMARKS = {
  ecommerce:  { ctr: 0.018, conversion_rate: 0.025, roas: 3.0, cpc: 1.5 },
  saas:       { ctr: 0.012, conversion_rate: 0.04,  roas: 2.5, cpc: 3.0 },
  services:   { ctr: 0.015, conversion_rate: 0.03,  roas: 2.0, cpc: 2.0 },
  education:  { ctr: 0.020, conversion_rate: 0.05,  roas: 2.0, cpc: 1.2 },
  default:    { ctr: 0.015, conversion_rate: 0.03,  roas: 2.5, cpc: 2.0 },
};

function _buildBenchmarks(unified, history, context) {
  const industry  = context.industry || 'default';
  const standard  = INDUSTRY_BENCHMARKS[industry] || INDUSTRY_BENCHMARKS.default;

  const vsBenchmark = {
    ctr:             _compare(unified.ctr, standard.ctr, 'higher'),
    conversion_rate: _compare(unified.conversion_rate, standard.conversion_rate, 'higher'),
    roas:            _compare(unified.roas, standard.roas, 'higher'),
    cpc:             _compare(unified.cpc, standard.cpc, 'lower'),
  };

  // Historical benchmarks
  const vsPreviousPeriod = history.length >= 1 ? {
    conversions:  _comparePct(unified.conversions, history[history.length - 1]?.conversions),
    ctr:          _comparePct(unified.ctr, history[history.length - 1]?.ctr),
    roas:         _comparePct(unified.roas, history[history.length - 1]?.roas),
  } : null;

  const bestHistorical = history.length ? _findBestPeriod(history) : null;

  return {
    industry,
    standard,
    vs_benchmark: vsBenchmark,
    vs_previous_period: vsPreviousPeriod,
    best_historical: bestHistorical,
    performance_grade: _gradePerformance(vsBenchmark),
  };
}

function _compare(current, benchmark, direction) {
  if (current === null || current === undefined || !benchmark) return { status: 'no_data' };
  const ratio = current / benchmark;
  const above = direction === 'higher' ? current >= benchmark : current <= benchmark;
  return {
    current:   _round(current, 4),
    benchmark: _round(benchmark, 4),
    ratio:     _round(ratio, 2),
    status:    ratio >= 1.2 ? 'excellent' : ratio >= 0.9 ? 'on_par' : ratio >= 0.7 ? 'below' : 'poor',
    above_benchmark: above,
  };
}

function _comparePct(current, previous) {
  if (!previous || previous === 0) return null;
  return { pct_change: _round(((current - previous) / previous) * 100, 1), direction: current >= previous ? 'up' : 'down' };
}

function _findBestPeriod(history) {
  return history.reduce((best, h) => (!best || (h.roas || 0) > (best.roas || 0)) ? h : best, null);
}

function _gradePerformance(vsBenchmark) {
  const scores = Object.values(vsBenchmark).map(v => {
    if (!v || v.status === 'no_data') return 50;
    return { excellent: 100, on_par: 75, below: 50, poor: 25 }[v.status] || 50;
  });
  const avg = scores.reduce((s, v) => s + v, 0) / scores.length;
  return avg >= 85 ? 'A' : avg >= 70 ? 'B' : avg >= 55 ? 'C' : avg >= 40 ? 'D' : 'F';
}

function _findTopChannel(attribution) {
  if (!attribution.channels?.length) return null;
  return attribution.channels[0];
}

function _buildAttributionSummary(attribution, topChannel, benchmarks) {
  const grade = benchmarks.performance_grade;
  const top   = topChannel ? `ערוץ מוביל: ${topChannel.platform}` : '';
  return `ציון ביצועים: ${grade} ${top ? `| ${top}` : ''} | ${attribution.note || ''}`;
}

function _aggRows(rows) {
  if (!rows || !rows.length) return {};
  return rows.reduce((a, r) => ({
    clicks:      (a.clicks || 0)      + (r.clicks || 0),
    conversions: (a.conversions || 0) + (r.conversions || 0),
    cost:        (a.cost || 0)        + (r.cost || 0),
    revenue:     (a.revenue || 0)     + (r.revenue || 0),
  }), {});
}

function _round(v, d) { return Math.round(v * Math.pow(10, d)) / Math.pow(10, d); }

module.exports = { runAttribution };
