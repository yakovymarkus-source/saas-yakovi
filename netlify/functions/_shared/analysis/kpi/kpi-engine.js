'use strict';
/**
 * analysis/kpi/kpi-engine.js
 * Goal-based KPI selection and hierarchy engine.
 * Maps campaign goals → primary KPI, secondary KPIs, operational metrics.
 */

// ── Goal → KPI mapping ─────────────────────────────────────────────────────────
const GOAL_KPI_MAP = {
  leads: {
    primary:     { key: 'cpl', label: 'CPL (עלות ליד)', formula: m => m.cpa },
    secondary:   [
      { key: 'conversion_rate', label: 'שיעור המרה' },
      { key: 'ctr',             label: 'CTR' },
    ],
    operational: ['impressions', 'clicks', 'cpc', 'frequency'],
  },
  sales: {
    primary:     { key: 'roas', label: 'ROAS', formula: m => m.roas },
    secondary:   [
      { key: 'cpa',  label: 'CPA (עלות רכישה)' },
      { key: 'revenue', label: 'הכנסות' },
    ],
    operational: ['impressions', 'clicks', 'conversion_rate', 'cost'],
  },
  content: {
    primary:     { key: 'engagement_rate', label: 'שיעור מעורבות', formula: m => m.impressions > 0 ? m.engagement / m.impressions : 0 },
    secondary:   [
      { key: 'reach',     label: 'טווח הגעה' },
      { key: 'followers', label: 'גידול עוקבים' },
    ],
    operational: ['impressions', 'clicks', 'ctr'],
  },
  awareness: {
    primary:     { key: 'cpm', label: 'CPM', formula: m => m.impressions > 0 ? (m.cost / m.impressions) * 1000 : 0 },
    secondary:   [
      { key: 'reach',     label: 'טווח הגעה' },
      { key: 'frequency', label: 'תדירות' },
    ],
    operational: ['impressions', 'engagement', 'ctr'],
  },
  traffic: {
    primary:     { key: 'cpc', label: 'CPC', formula: m => m.cpc },
    secondary:   [
      { key: 'ctr',     label: 'CTR' },
      { key: 'clicks',  label: 'קליקים' },
    ],
    operational: ['impressions', 'cost', 'conversion_rate'],
  },
};

/**
 * Build KPI hierarchy for a given campaign.
 * @param {object} unified   — unified metrics object from data-normalizer
 * @param {string} goal      — 'leads' | 'sales' | 'content' | 'awareness' | 'traffic'
 * @param {object} targets   — optional user-set targets { cpl: 50, roas: 3, ... }
 * @returns {object}
 */
function buildKpiHierarchy(unified, goal = 'leads', targets = {}) {
  const mapping = GOAL_KPI_MAP[goal] || GOAL_KPI_MAP.leads;

  // Compute primary KPI value
  const primaryValue  = mapping.primary.formula ? mapping.primary.formula(unified) : null;
  const primaryTarget = targets[mapping.primary.key] || null;
  const primaryStatus = _kpiStatus(mapping.primary.key, primaryValue, primaryTarget, goal);

  // Compute secondary KPI values
  const secondary = mapping.secondary.map(kpi => ({
    ...kpi,
    value:  unified[kpi.key] ?? null,
    target: targets[kpi.key] || null,
    status: _kpiStatus(kpi.key, unified[kpi.key], targets[kpi.key], goal),
  }));

  // Operational metrics (just values, no status)
  const operational = mapping.operational.map(key => ({
    key,
    value: unified[key] ?? null,
  }));

  // Overall goal score
  const goalScore = _calcGoalScore(goal, unified, targets);

  return {
    goal,
    primary: {
      ...mapping.primary,
      value:  primaryValue,
      target: primaryTarget,
      status: primaryStatus,
    },
    secondary,
    operational,
    goal_score:   goalScore,
    goal_verdict: goalScore >= 70 ? 'on_track' : goalScore >= 45 ? 'at_risk' : 'off_track',
  };
}

function _kpiStatus(key, value, target, goal) {
  if (value === null || value === undefined) return 'no_data';
  if (!target) return 'no_target';

  // For cost-based KPIs (lower is better)
  const lowerIsBetter = ['cpl', 'cpa', 'cpc', 'cpm', 'cost'];
  if (lowerIsBetter.includes(key)) {
    if (value <= target * 0.90) return 'excellent';
    if (value <= target)        return 'on_target';
    if (value <= target * 1.20) return 'slightly_over';
    return 'over_budget';
  }
  // For performance KPIs (higher is better)
  if (value >= target * 1.10) return 'excellent';
  if (value >= target)        return 'on_target';
  if (value >= target * 0.80) return 'slightly_below';
  return 'below_target';
}

function _calcGoalScore(goal, m, targets) {
  if (goal === 'leads') {
    const ctrOk  = m.ctr >= 0.01 ? 25 : m.ctr >= 0.005 ? 12 : 0;
    const crOk   = m.conversion_rate >= 0.03 ? 35 : m.conversion_rate >= 0.01 ? 18 : 0;
    const cpaOk  = targets.cpl && m.cpa ? (m.cpa <= targets.cpl ? 40 : m.cpa <= targets.cpl * 1.3 ? 22 : 0) : 20;
    return Math.min(100, ctrOk + crOk + cpaOk);
  }
  if (goal === 'sales') {
    const roasOk = m.roas >= 3 ? 50 : m.roas >= 1.5 ? 30 : m.roas >= 1 ? 15 : 0;
    const crOk   = m.conversion_rate >= 0.02 ? 30 : m.conversion_rate >= 0.005 ? 15 : 0;
    const ctrOk  = m.ctr >= 0.01 ? 20 : m.ctr >= 0.005 ? 10 : 0;
    return Math.min(100, roasOk + crOk + ctrOk);
  }
  if (goal === 'content') {
    const engRate = m.impressions > 0 ? m.engagement / m.impressions : 0;
    const engOk   = engRate >= 0.05 ? 50 : engRate >= 0.02 ? 30 : 10;
    const reachOk = m.reach > 10000 ? 30 : m.reach > 1000 ? 15 : 5;
    const fwOk    = m.followers > 0 ? 20 : 0;
    return Math.min(100, engOk + reachOk + fwOk);
  }
  // Default
  const hasData = (m.impressions > 0 ? 30 : 0) + (m.clicks > 0 ? 40 : 0) + (m.conversions > 0 ? 30 : 0);
  return hasData;
}

module.exports = { buildKpiHierarchy, GOAL_KPI_MAP };
