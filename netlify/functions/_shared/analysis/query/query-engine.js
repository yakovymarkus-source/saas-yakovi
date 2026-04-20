'use strict';
/**
 * analysis/query/query-engine.js
 * Answers specific questions about campaign performance.
 * e.g. "why did campaign X drop?", "what's my best performing platform?", "is my ROAS improving?"
 */

const QUERY_PATTERNS = [
  { pattern: /למה.*ירד|why.*drop|מה.*הסיב/i,         type: 'why_drop' },
  { pattern: /הכי טוב|best.*platform|פלטפורמ/i,      type: 'best_platform' },
  { pattern: /ROAS|החזר|roi/i,                        type: 'roas_status' },
  { pattern: /המרה|conversion|ליד|lead/i,             type: 'conversion_status' },
  { pattern: /תקציב|budget|הוצא/i,                    type: 'budget_status' },
  { pattern: /מה לעש|what.*do|פעול/i,                 type: 'next_action' },
  { pattern: /השוואה|compar|לעומת|vs/i,               type: 'comparison' },
  { pattern: /גידול|growth|עוקב|follower/i,           type: 'growth_status' },
  { pattern: /אנומל|anomal|חריג/i,                    type: 'anomaly_status' },
  { pattern: /סיכום|summary|overview|תמונה/i,         type: 'overview' },
];

/**
 * @param {string} query        — natural-language question in Hebrew or English
 * @param {object} analysisData — full analysis result
 * @returns {{ answer, type, confidence, data }}
 */
function answerQuery(query, analysisData) {
  const type = _detectQueryType(query);
  const handler = QUERY_HANDLERS[type] || QUERY_HANDLERS.overview;
  return handler(query, analysisData);
}

function _detectQueryType(query) {
  for (const { pattern, type } of QUERY_PATTERNS) {
    if (pattern.test(query)) return type;
  }
  return 'overview';
}

// ── Query handlers ─────────────────────────────────────────────────────────────

const QUERY_HANDLERS = {

  why_drop(query, data) {
    const chains = data.causality?.chains || [];
    const anomalies = data.anomalies?.signals || [];
    const topCause = chains[0] || anomalies[0];

    if (!topCause) {
      return _ans('אין ירידה משמעותית בנתונים האחרונים', 'why_drop', 0.60, {});
    }
    const answer = topCause.change
      ? `${topCause.change}: ${topCause.reason}`
      : topCause.message;
    return _ans(answer, 'why_drop', topCause.confidence || 0.75, { topCause, chains, anomalies });
  },

  best_platform(query, data) {
    const byPlatform = data.byPlatform || {};
    let best = null, bestScore = -1;

    for (const [platform, rows] of Object.entries(byPlatform)) {
      const agg    = _aggRows(rows);
      const score  = _platformScore(agg);
      if (score > bestScore) { bestScore = score; best = { platform, agg, score }; }
    }

    if (!best) return _ans('אין נתונים לפי פלטפורמה', 'best_platform', 0.40, {});
    const { platform, agg } = best;
    return _ans(
      `הפלטפורמה הטובה ביותר: ${platform} — ROAS ${agg.roas?.toFixed(2)}x, CTR ${_pct(agg.ctr)}`,
      'best_platform', 0.80, { best, platforms: Object.keys(byPlatform) }
    );
  },

  roas_status(query, data) {
    const m = data.unified || {};
    const roas = m.roas ?? null;
    if (roas === null) return _ans('אין נתוני ROAS — בדוק חיבורי הכנסה', 'roas_status', 0.50, {});

    const status = roas >= 3 ? 'מצוין' : roas >= 2 ? 'טוב' : roas >= 1 ? 'סביר' : 'קריטי';
    const trend  = data.causality?.changes?.find(c => c.metric === 'roas');
    const trendTxt = trend ? ` (${trend.direction === 'up' ? '▲' : '▼'} ${Math.abs(trend.pct_change)}% מהתקופה הקודמת)` : '';

    return _ans(
      `ROAS: ${roas.toFixed(2)}x — ${status}${trendTxt}`,
      'roas_status', 0.85, { roas, status, trend }
    );
  },

  conversion_status(query, data) {
    const m = data.unified || {};
    const cr = m.conversion_rate || 0;
    const conversions = m.conversions || 0;
    const verdict = cr >= 0.03 ? 'טוב' : cr >= 0.01 ? 'ממוצע' : 'נמוך';
    return _ans(
      `שיעור המרה: ${_pct(cr)} (${verdict}) — ${conversions} המרות בסה"כ`,
      'conversion_status', 0.82, { cr, conversions, verdict }
    );
  },

  budget_status(query, data) {
    const m = data.unified || {};
    const cost = m.cost || 0;
    const roas = m.roas || 0;
    const efficient = roas >= 2;
    return _ans(
      `הוצאה: $${cost.toFixed(0)} | ROAS: ${roas.toFixed(2)}x — תקציב ${efficient ? 'יעיל' : 'לא יעיל'}`,
      'budget_status', 0.80, { cost, roas, efficient }
    );
  },

  next_action(query, data) {
    const priorities = data.insights?.priorities || [];
    const topInsight = priorities[0];
    if (!topInsight) return _ans('המשך לנטר — אין פעולה דחופה כרגע', 'next_action', 0.60, {});
    return _ans(
      `הפעולה הבאה המומלצת: ${topInsight.impact}`,
      'next_action', 0.78, { topInsight }
    );
  },

  comparison(query, data) {
    const causality = data.causality || {};
    if (!causality.hasComparison) return _ans('אין נתוני תקופה קודמת להשוואה', 'comparison', 0.50, {});
    const topChange = causality.changes?.[0];
    if (!topChange) return _ans('אין שינויים משמעותיים לעומת התקופה הקודמת', 'comparison', 0.70, {});
    return _ans(
      `השינוי הגדול ביותר: ${topChange.metric} שינה ב-${topChange.pct_change}%`,
      'comparison', 0.80, { topChange, changes: causality.changes }
    );
  },

  growth_status(query, data) {
    const social = data.social || {};
    if (!social.has_social_data) return _ans('אין נתוני מדיה חברתית', 'growth_status', 0.40, {});
    const combined = social.combined || {};
    return _ans(
      `עוקבים כולל: ${combined.total_followers?.toLocaleString()} | ${combined.platforms_growing} פלטפורמות בגידול`,
      'growth_status', 0.75, { combined }
    );
  },

  anomaly_status(query, data) {
    const anomalies = data.anomalies || {};
    if (!anomalies.has_anomalies) return _ans('לא זוהו אנומליות — הנתונים נראים תקינים', 'anomaly_status', 0.80, {});
    return _ans(
      `${anomalies.count} אנומליות זוהו: ${anomalies.summary}`,
      'anomaly_status', 0.85, { anomalies: anomalies.signals }
    );
  },

  overview(query, data) {
    const insights = data.insights || {};
    const narrative = insights.narrative || 'אין נתונים מספיקים לניתוח';
    return _ans(narrative, 'overview', 0.75, { insights: insights.priorities?.slice(0, 3) });
  },
};

function _ans(answer, type, confidence, data) {
  return { answer, type, confidence, data, generated_at: new Date().toISOString() };
}

function _platformScore(agg) {
  return (agg.roas || 0) * 30 + (agg.ctr || 0) * 1000 + (agg.conversion_rate || 0) * 500;
}

function _aggRows(rows) {
  if (!rows || !rows.length) return {};
  const tot = rows.reduce((a, r) => ({
    impressions: a.impressions + (r.impressions || 0),
    clicks:      a.clicks      + (r.clicks || 0),
    conversions: a.conversions + (r.conversions || 0),
    cost:        a.cost        + (r.cost || 0),
    revenue:     a.revenue     + (r.revenue || 0),
  }), { impressions: 0, clicks: 0, conversions: 0, cost: 0, revenue: 0 });
  return {
    ...tot,
    ctr:             tot.impressions > 0 ? tot.clicks / tot.impressions : 0,
    conversion_rate: tot.clicks > 0 ? tot.conversions / tot.clicks : 0,
    roas:            tot.cost > 0 ? tot.revenue / tot.cost : 0,
  };
}

function _pct(v) { return `${((v || 0) * 100).toFixed(2)}%`; }

module.exports = { answerQuery };
