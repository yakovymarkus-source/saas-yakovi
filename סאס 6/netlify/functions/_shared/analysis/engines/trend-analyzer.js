'use strict';
/**
 * analysis/engines/trend-analyzer.js
 * Trend analysis: rise/fall detection, seasonality, sharp changes, creative performance.
 * Works with history arrays (ordered oldest → newest).
 */

/**
 * @param {object} current  — unified metrics
 * @param {object[]} history — array of past unified metrics snapshots
 * @param {object[]} creativeData — optional array of creative performance rows
 * @returns {{ trends, seasonality, sharpChanges, creativeInsights, summary }}
 */
function analyzeTrends(current, history = [], creativeData = []) {
  const trends        = _detectTrends(current, history);
  const seasonality   = _detectSeasonality(history);
  const sharpChanges  = _detectSharpChanges(history);
  const creativeInsights = _analyzeCreativePerformance(creativeData);
  const summary       = _buildTrendSummary(trends, sharpChanges);

  return { trends, seasonality, sharp_changes: sharpChanges, creative_insights: creativeInsights, summary, has_history: history.length >= 2 };
}

// ── Trend detection ────────────────────────────────────────────────────────────

const TREND_METRICS = ['impressions', 'clicks', 'ctr', 'conversions', 'conversion_rate', 'roas', 'cost', 'cpa'];

function _detectTrends(current, history) {
  if (history.length < 2) return { available: false, note: 'נדרשות לפחות 2 תקופות להיסטוריה' };

  const trends = {};
  for (const key of TREND_METRICS) {
    const values = [...history.map(h => h[key] || 0), current[key] || 0];
    trends[key] = _calcTrend(key, values);
  }
  return { available: true, metrics: trends };
}

function _calcTrend(key, values) {
  if (values.length < 2) return null;
  const recent    = values.slice(-3);
  const older     = values.slice(0, -3);
  const recentAvg = _avg(recent);
  const olderAvg  = older.length ? _avg(older) : recent[0];

  const pctChange = olderAvg > 0 ? ((recentAvg - olderAvg) / olderAvg) * 100 : 0;
  const isImproving = _isPositiveMetric(key) ? pctChange > 0 : pctChange < 0;
  const direction = pctChange > 5 ? 'up' : pctChange < -5 ? 'down' : 'stable';

  return {
    direction,
    pct_change:   _round(pctChange, 1),
    recent_avg:   _round(recentAvg, 3),
    older_avg:    _round(olderAvg, 3),
    is_improving: isImproving,
    velocity:     _calcVelocity(values),
  };
}

function _calcVelocity(values) {
  if (values.length < 3) return 'insufficient_data';
  const last  = values[values.length - 1];
  const prev  = values[values.length - 2];
  const pprev = values[values.length - 3];
  const v1 = prev - pprev;
  const v2 = last - prev;
  if (v1 === 0) return 'stable';
  const accel = v2 - v1;
  return accel > 0 ? 'accelerating' : accel < 0 ? 'decelerating' : 'constant';
}

function _isPositiveMetric(key) {
  return ['impressions', 'clicks', 'ctr', 'conversions', 'conversion_rate', 'roas', 'revenue', 'engagement', 'followers'].includes(key);
}

// ── Seasonality ────────────────────────────────────────────────────────────────

function _detectSeasonality(history) {
  if (history.length < 7) return { detected: false, note: 'נדרשות 7+ תקופות לזיהוי עונתיות' };

  const byDow = {};
  history.forEach((h, i) => {
    const dow = i % 7;
    if (!byDow[dow]) byDow[dow] = [];
    byDow[dow].push(h.conversions || 0);
  });

  const dowAvg = Object.entries(byDow).map(([dow, vals]) => ({ dow: parseInt(dow), avg: _avg(vals) }));
  dowAvg.sort((a, b) => b.avg - a.avg);

  return {
    detected:    true,
    best_day:    dowAvg[0]?.dow,
    worst_day:   dowAvg[dowAvg.length - 1]?.dow,
    pattern:     dowAvg,
    note:        'עונתיות מחושבת לפי יום בשבוע',
  };
}

// ── Sharp changes ──────────────────────────────────────────────────────────────

function _detectSharpChanges(history) {
  if (history.length < 2) return [];

  const changes = [];
  const key = 'conversions';

  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1][key] || 0;
    const curr = history[i][key] || 0;
    if (prev === 0) continue;
    const pct = ((curr - prev) / prev) * 100;
    if (Math.abs(pct) >= 30) {
      changes.push({
        period:     i,
        metric:     key,
        pct_change: _round(pct, 1),
        direction:  pct > 0 ? 'spike' : 'drop',
        severity:   Math.abs(pct) >= 50 ? 'critical' : 'high',
        note:       `${pct > 0 ? 'עלייה' : 'ירידה'} חדה של ${Math.abs(_round(pct, 0))}%`,
      });
    }
  }

  return changes;
}

// ── Creative performance ───────────────────────────────────────────────────────

function _analyzeCreativePerformance(creativeData) {
  if (!creativeData || !creativeData.length) {
    return { available: false, note: 'אין נתוני קריאייטיב' };
  }

  const sorted = [...creativeData].sort((a, b) => (b.ctr || 0) - (a.ctr || 0));
  const top3   = sorted.slice(0, 3);
  const worst3 = sorted.slice(-3).reverse();

  const avgCtr = _avg(creativeData.map(c => c.ctr || 0));
  const avgConv = _avg(creativeData.map(c => c.conversion_rate || 0));

  const winners = top3.map(c => ({
    id:              c.id || c.campaign_id,
    hook:            c.hook || c.headline || c.title || 'לא צוין',
    ctr:             c.ctr,
    conversion_rate: c.conversion_rate,
    why:             c.ctr > avgCtr * 1.3 ? 'CTR גבוה משמעותית מהממוצע' : 'ביצועי המרה חזקים',
  }));

  const losers = worst3.map(c => ({
    id:              c.id || c.campaign_id,
    hook:            c.hook || c.headline || c.title || 'לא צוין',
    ctr:             c.ctr,
    issue:           (c.ctr || 0) < avgCtr * 0.5 ? 'CTR נמוך מאוד — הוק חלש' : 'המרה חלשה',
  }));

  return {
    available:   true,
    count:       creativeData.length,
    avg_ctr:     _round(avgCtr, 4),
    avg_conv:    _round(avgConv, 4),
    winners,
    losers,
    insight:     winners.length ? `הוק מנצח: "${winners[0].hook}" — CTR ${_pct(winners[0].ctr)}` : null,
  };
}

function _buildTrendSummary(trends, sharpChanges) {
  if (!trends.available) return 'אין מספיק היסטוריה לניתוח מגמות';
  const down = Object.entries(trends.metrics || {})
    .filter(([, t]) => t?.direction === 'down' && _isPositiveMetric([0]))
    .map(([k]) => k);
  if (sharpChanges.some(c => c.severity === 'critical')) return `שינוי חד קריטי זוהה — ${sharpChanges[0].note}`;
  if (down.length >= 3) return `מגמת ירידה ב-${down.slice(0,2).join(', ')} — בדוק כיוון הקמפיין`;
  return 'מגמות יציבות — אין שינויים דרמטיים';
}

function _avg(arr) { return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0; }
function _round(v, d) { return Math.round(v * Math.pow(10, d)) / Math.pow(10, d); }
function _pct(v) { return `${((v || 0) * 100).toFixed(2)}%`; }

module.exports = { analyzeTrends };
