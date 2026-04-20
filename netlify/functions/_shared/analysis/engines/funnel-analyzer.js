'use strict';
/**
 * analysis/engines/funnel-analyzer.js
 * Full funnel analysis: impressions → clicks → landing → lead → purchase.
 * Identifies exactly where the funnel breaks and why.
 */

/**
 * @param {object} metrics   — unified metrics from data-normalizer
 * @param {object} context   — optional { goal, platform, industry }
 * @returns {{ funnel, bottleneck, stages, conversion_map, summary }}
 */
function analyzeFunnel(metrics, context = {}) {
  const funnel = _buildFunnel(metrics);
  const stages = _analyzeStages(funnel);
  const bottleneck = _findBottleneck(stages);
  const conversionMap = _buildConversionMap(funnel);
  const lossMap = _buildLossMap(funnel);
  const summary = _buildFunnelSummary(bottleneck, stages, funnel);

  return { funnel, stages, bottleneck, conversion_map: conversionMap, loss_map: lossMap, summary };
}

// ── Funnel builder ─────────────────────────────────────────────────────────────

function _buildFunnel(m) {
  return {
    impressions: m.impressions || 0,
    clicks:      m.clicks      || 0,
    landing:     m.landingPageViews || m.sessions || m.clicks || 0, // best estimate
    leads:       m.conversions || 0,
    customers:   m.purchases   || 0,
  };
}

// ── Stage analysis ─────────────────────────────────────────────────────────────

const STAGE_BENCHMARKS = {
  impression_to_click:   { good: 0.02,  ok: 0.01,  label: 'CTR' },
  click_to_landing:      { good: 0.90,  ok: 0.75,  label: 'Landing Rate' },
  landing_to_lead:       { good: 0.05,  ok: 0.02,  label: 'Lead Rate' },
  lead_to_customer:      { good: 0.10,  ok: 0.05,  label: 'Close Rate' },
};

function _analyzeStages(funnel) {
  const stages = [];

  const defs = [
    { id: 'impression_to_click',   from: funnel.impressions, to: funnel.clicks,   label: 'חשיפה → קליק' },
    { id: 'click_to_landing',      from: funnel.clicks,      to: funnel.landing,  label: 'קליק → דף נחיתה' },
    { id: 'landing_to_lead',       from: funnel.landing,     to: funnel.leads,    label: 'דף נחיתה → ליד' },
    { id: 'lead_to_customer',      from: funnel.leads,       to: funnel.customers, label: 'ליד → לקוח' },
  ];

  for (const def of defs) {
    if (def.from === 0) { stages.push({ ...def, rate: 0, status: 'no_data', loss: 0 }); continue; }
    const rate   = def.to / def.from;
    const bench  = STAGE_BENCHMARKS[def.id];
    const status = rate >= bench.good ? 'good' : rate >= bench.ok ? 'ok' : 'weak';
    const loss   = def.from - def.to;
    stages.push({ ...def, rate: _round(rate, 4), status, loss, benchmark: bench });
  }

  return stages;
}

// ── Bottleneck finder ──────────────────────────────────────────────────────────

function _findBottleneck(stages) {
  const withData = stages.filter(s => s.status !== 'no_data' && s.from > 0);
  if (!withData.length) return { stage: 'unknown', impact: 'no_data', message: 'אין נתונים לזיהוי צוואר בקבוק' };

  // Weighted score: weak stages with large absolute loss = highest impact
  const scored = withData.map(s => ({
    ...s,
    impact_score: (1 - s.rate) * Math.log10(s.from + 1),
  }));
  scored.sort((a, b) => b.impact_score - a.impact_score);

  const top = scored[0];
  const actions = {
    impression_to_click: 'שפר קריאייטיב וטרגטינג — CTR נמוך = מסר לא רלוונטי',
    click_to_landing:    'בדוק מהירות דף ופיקסל — תנועה הולכת לאיבוד',
    landing_to_lead:     'שפר CTA, הצעה, ו-UX של דף הנחיתה',
    lead_to_customer:    'שפר תהליך מכירה ו-follow up על לידים',
  };

  return {
    stage:   top.id,
    label:   top.label,
    rate:    top.rate,
    status:  top.status,
    loss:    top.loss,
    impact:  top.impact_score >= 2 ? 'critical' : top.impact_score >= 1 ? 'high' : 'medium',
    action:  actions[top.id] || 'בדוק את השלב הזה לעומק',
    message: `${top.label}: המרה ${_pct(top.rate)} — זה המקום שנשפך הכי הרבה כסף`,
  };
}

// ── Conversion map ─────────────────────────────────────────────────────────────

function _buildConversionMap(funnel) {
  return {
    overall:        funnel.impressions > 0 ? _round(funnel.leads / funnel.impressions, 6) : 0,
    click_rate:     funnel.impressions > 0 ? _round(funnel.clicks / funnel.impressions, 4) : 0,
    lead_rate:      funnel.clicks > 0 ? _round(funnel.leads / funnel.clicks, 4) : 0,
    customer_rate:  funnel.leads > 0 ? _round(funnel.customers / funnel.leads, 4) : 0,
    end_to_end:     funnel.impressions > 0 && funnel.customers > 0
      ? `1 לקוח מכל ${Math.round(funnel.impressions / funnel.customers).toLocaleString()} חשיפות`
      : null,
  };
}

// ── Loss map ───────────────────────────────────────────────────────────────────

function _buildLossMap(funnel) {
  return {
    lost_at_click:   Math.max(0, funnel.impressions - funnel.clicks),
    lost_at_landing: Math.max(0, funnel.clicks - funnel.landing),
    lost_at_lead:    Math.max(0, funnel.landing - funnel.leads),
    lost_at_sale:    Math.max(0, funnel.leads - funnel.customers),
  };
}

function _buildFunnelSummary(bottleneck, stages, funnel) {
  const weakStages = stages.filter(s => s.status === 'weak').map(s => s.label);
  if (!weakStages.length && bottleneck.stage === 'unknown') return 'אין נתוני משפך — חבר מקורות נתונים';
  if (!weakStages.length) return `המשפך נראה תקין — ${_pct(funnel.clicks > 0 ? funnel.leads / funnel.clicks : 0)} שיעור המרה`;
  return `${bottleneck.message}. שלבים חלשים: ${weakStages.join(', ')}`;
}

function _pct(v) { return `${((v || 0) * 100).toFixed(2)}%`; }
function _round(v, d) { return Math.round(v * Math.pow(10, d)) / Math.pow(10, d); }

module.exports = { analyzeFunnel };
