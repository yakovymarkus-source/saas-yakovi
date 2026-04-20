'use strict';
/**
 * analysis/engines/business-layer.js
 * Business intelligence: LTV, CAC, profitability, scalability analysis.
 * Answers: "is the business healthy from a unit economics standpoint?"
 */

/**
 * @param {object} unified        — unified metrics
 * @param {object} businessProfile — user's business profile (margins, avg order value, etc.)
 * @param {object} context        — { goal, priceTier }
 * @returns {{ unitEconomics, profitability, scalability, alerts, summary }}
 */
function analyzeBusinessLayer(unified, businessProfile = {}, context = {}) {
  const unitEconomics  = _calcUnitEconomics(unified, businessProfile, context);
  const profitability  = _calcProfitability(unified, unitEconomics, businessProfile);
  const scalability    = _assessScalability(unified, unitEconomics, profitability);
  const alerts         = _buildBusinessAlerts(unitEconomics, profitability, scalability);
  const summary        = _buildBusinessSummary(unitEconomics, profitability, scalability);

  return { unit_economics: unitEconomics, profitability, scalability, alerts, summary };
}

// ── Unit Economics ─────────────────────────────────────────────────────────────

function _calcUnitEconomics(unified, profile, context) {
  const cac    = unified.cpa || (unified.conversions > 0 ? unified.cost / unified.conversions : null);
  const ltv    = _estimateLtv(profile, context);
  const ltvCacRatio = (ltv && cac && cac > 0) ? _round(ltv / cac, 2) : null;

  return {
    cac:            cac ? _round(cac, 2) : null,
    ltv:            ltv,
    ltv_cac_ratio:  ltvCacRatio,
    ltv_cac_health: _ltvCacHealth(ltvCacRatio),
    payback_months: (cac && ltv && ltv > 0) ? _round(cac / (ltv / 12), 1) : null,
    avg_order_value: profile.avgOrderValue || context.avgRevenue || _estimateAov(unified),
    cost_per_click:  unified.cpc ? _round(unified.cpc, 2) : null,
    cost_per_impression: unified.impressions > 0 ? _round((unified.cost / unified.impressions) * 1000, 2) : null,
  };
}

function _estimateLtv(profile, context) {
  if (profile.ltv)           return profile.ltv;
  if (profile.avgOrderValue) return profile.avgOrderValue * (profile.repeatPurchaseRate || 2);
  const priceTierLtv = { high: 2000, medium: 400, low: 100 };
  return priceTierLtv[context.priceTier] || 400;
}

function _estimateAov(unified) {
  if (unified.revenue && unified.conversions) return _round(unified.revenue / unified.conversions, 2);
  return null;
}

function _ltvCacHealth(ratio) {
  if (ratio === null) return 'no_data';
  if (ratio >= 3)    return 'excellent';  // 3:1 is the golden ratio
  if (ratio >= 2)    return 'good';
  if (ratio >= 1)    return 'break_even';
  return 'negative';
}

// ── Profitability ──────────────────────────────────────────────────────────────

function _calcProfitability(unified, unitEcon, profile) {
  const grossMargin  = profile.grossMargin || 0.60; // default 60% margin
  const revenue      = unified.revenue || 0;
  const cost         = unified.cost || 0;
  const grossProfit  = revenue * grossMargin;
  const netProfit    = grossProfit - cost;
  const profitMargin = revenue > 0 ? _round(netProfit / revenue, 3) : null;

  return {
    revenue:       _round(revenue, 2),
    ad_spend:      _round(cost, 2),
    gross_profit:  _round(grossProfit, 2),
    net_profit:    _round(netProfit, 2),
    profit_margin: profitMargin,
    roas:          unified.roas || 0,
    break_even_roas: grossMargin > 0 ? _round(1 / grossMargin, 2) : null,
    is_profitable: netProfit > 0,
    profit_verdict: netProfit > 0 ? 'רווחי' : netProfit === 0 ? 'איזון' : 'הפסד',
  };
}

// ── Scalability ────────────────────────────────────────────────────────────────

function _assessScalability(unified, unitEcon, profitability) {
  const canScale    = profitability.is_profitable && unitEcon.ltv_cac_ratio && unitEcon.ltv_cac_ratio >= 2;
  const bottleneck  = !canScale ? _findScalingBottleneck(unified, unitEcon, profitability) : null;

  return {
    can_scale:    canScale,
    confidence:   _calcScaleConfidence(unified, unitEcon),
    recommended_budget_change: canScale ? '+20%' : '0% (תקן תחילה)',
    bottleneck,
    scaling_verdict: canScale ? 'מוכן לסקייל' : 'לא מוכן לסקייל',
    max_scale_factor: canScale ? _calcMaxScale(unified, unitEcon) : 1,
  };
}

function _findScalingBottleneck(unified, unitEcon, profitability) {
  if (!profitability.is_profitable)           return 'לא רווחי — תקן ROAS לפני הגדלת תקציב';
  if (!unitEcon.ltv_cac_ratio)                return 'חסרים נתוני LTV/CAC';
  if (unitEcon.ltv_cac_ratio < 1)             return 'LTV:CAC נמוך מ-1:1 — עסק לא בר-קיימא';
  if (unified.conversion_rate < 0.01)         return 'שיעור המרה נמוך מדי לסקייל';
  return 'בדוק נתוני עלות ורווחיות';
}

function _calcScaleConfidence(unified, unitEcon) {
  let score = 0;
  if (unified.impressions > 1000) score += 20;
  if (unified.conversions > 10)   score += 20;
  if (unitEcon.ltv !== null)      score += 20;
  if (unified.roas > 2)           score += 25;
  if (unified.conversion_rate > 0.02) score += 15;
  return Math.min(100, score);
}

function _calcMaxScale(unified, unitEcon) {
  if (unitEcon.ltv_cac_ratio >= 5) return 3.0;
  if (unitEcon.ltv_cac_ratio >= 3) return 2.0;
  return 1.3;
}

// ── Business alerts ────────────────────────────────────────────────────────────

function _buildBusinessAlerts(unitEcon, profitability, scalability) {
  const alerts = [];

  if (unitEcon.ltv_cac_health === 'negative') {
    alerts.push({ severity: 'critical', code: 'negative_unit_economics', message: `LTV:CAC < 1 — כל לקוח עולה יותר ממה שהוא מביא. עצור הגדלת תקציב.` });
  }
  if (!profitability.is_profitable && (profitability.ad_spend || 0) > 100) {
    alerts.push({ severity: 'high', code: 'unprofitable', message: `הפסד נטו: $${Math.abs(profitability.net_profit || 0).toFixed(0)} — ROAS ${profitability.roas?.toFixed(2)}x, צריך ${profitability.break_even_roas}x לאיזון` });
  }
  if (unitEcon.payback_months && unitEcon.payback_months > 12) {
    alerts.push({ severity: 'medium', code: 'long_payback', message: `החזר תקציב ${unitEcon.payback_months} חודשים — מחזור ארוך מדי` });
  }
  if (scalability.can_scale && scalability.confidence >= 70) {
    alerts.push({ severity: 'opportunity', code: 'scale_ready', message: `הזדמנות סקייל: LTV:CAC ${unitEcon.ltv_cac_ratio}:1 — הגדל תקציב ב-${Math.round((scalability.max_scale_factor - 1) * 100)}%` });
  }

  return alerts;
}

function _buildBusinessSummary(unitEcon, profitability, scalability) {
  if (!profitability.revenue) return 'אין נתוני הכנסה — חבר tracking המרות עם ערך';
  const ltvStr = unitEcon.ltv_cac_ratio ? `LTV:CAC ${unitEcon.ltv_cac_ratio}:1` : '';
  const profStr = profitability.profit_verdict;
  const scaleStr = scalability.scaling_verdict;
  return `${profStr} | ${ltvStr} | ${scaleStr}`;
}

function _round(v, d) { return Math.round(v * Math.pow(10, d)) / Math.pow(10, d); }

module.exports = { analyzeBusinessLayer };
