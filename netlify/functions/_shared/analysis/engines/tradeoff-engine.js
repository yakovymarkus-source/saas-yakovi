'use strict';
/**
 * analysis/engines/tradeoff-engine.js
 * Identifies and explains tradeoffs: CTR↑ vs quality↓, CPL↓ vs lead quality↓, etc.
 * Prevents blind optimization that improves one metric while damaging another.
 */

/**
 * @param {object} unified      — current metrics
 * @param {object} previous     — previous period metrics
 * @param {object} kpiHierarchy — from kpi-engine
 * @returns {{ tradeoffs, warnings, summary }}
 */
function analyzeTradeoffs(unified, previous = null, kpiHierarchy = null) {
  const tradeoffs = [];

  // ── CTR vs Conversion Rate (quality signal) ────────────────────────────────
  if (unified.ctr > 0 && unified.conversion_rate < 0.01) {
    tradeoffs.push({
      id:       'ctr_vs_quality',
      type:     'quality_tradeoff',
      metric_a: { key: 'ctr',             value: unified.ctr,             label: 'CTR' },
      metric_b: { key: 'conversion_rate', value: unified.conversion_rate, label: 'שיעור המרה' },
      verdict:  'ctr_good_quality_bad',
      explanation: 'CTR גבוה אבל המרה נמוכה — מושכים קליקים מקהל לא מתאים',
      risk:     'הגדלת תקציב תגדיל הוצאה אבל לא המרות',
      action:   'צמצם קהל, בדוק התאמת מסר בין מודעה לדף',
      severity: 'high',
    });
  }

  // ── CPL↓ vs Lead Quality↓ ─────────────────────────────────────────────────
  if (previous && unified.cpa < (previous.cpa || 0) * 0.7 && unified.conversion_rate < (previous.conversion_rate || 0) * 0.7) {
    tradeoffs.push({
      id:       'cpl_vs_lead_quality',
      type:     'cost_quality_tradeoff',
      metric_a: { key: 'cpa', value: unified.cpa, label: 'CPL' },
      metric_b: { key: 'conversion_rate', value: unified.conversion_rate, label: 'שיעור המרה' },
      verdict:  'cheaper_but_worse',
      explanation: 'CPL ירד אבל גם המרה ירדה — יותר לידים זולים = פחות איכות',
      risk:     'לידים זולים שלא נסגרים = עלות גבוהה יותר בפועל',
      action:   'בדוק את איכות הלידים מול המחיר — ייתכן שה-CPL הישן היה טוב יותר',
      severity: 'medium',
    });
  }

  // ── Scale vs Efficiency ────────────────────────────────────────────────────
  if (previous && (unified.cost || 0) > (previous.cost || 0) * 1.3 && (unified.roas || 0) < (previous.roas || 0) * 0.85) {
    tradeoffs.push({
      id:       'scale_vs_efficiency',
      type:     'scale_tradeoff',
      metric_a: { key: 'cost', value: unified.cost, label: 'הוצאה' },
      metric_b: { key: 'roas', value: unified.roas, label: 'ROAS' },
      verdict:  'scaled_but_inefficient',
      explanation: 'הגדלת תקציב הורידה יעילות — תופעה נפוצה בסקייל',
      risk:     'בנקודה מסוימת, סקייל = הפסד',
      action:   'בדוק מהו ה-sweet spot לתקציב. אולי 20% עלייה ולא 30%',
      severity: 'medium',
    });
  }

  // ── Frequency vs Fresh Audience ────────────────────────────────────────────
  if (unified.frequency && unified.frequency > 3 && unified.ctr < 0.01) {
    tradeoffs.push({
      id:       'frequency_vs_audience',
      type:     'audience_tradeoff',
      metric_a: { key: 'frequency', value: unified.frequency, label: 'תדירות' },
      metric_b: { key: 'ctr',       value: unified.ctr,       label: 'CTR' },
      verdict:  'saturated_audience',
      explanation: `תדירות ${unified.frequency.toFixed(1)}x = אותו אדם רואה את המודעה ${Math.round(unified.frequency)} פעמים`,
      risk:     'שחיקת קהל מהירה + CTR יורד = עלות עולה',
      action:   'הרחב קהל חדש + הוסף exclusions לקהל שחוק',
      severity: 'high',
    });
  }

  // ── Confidence calibration ─────────────────────────────────────────────────
  const calibration = _calibrateConfidence(unified, tradeoffs);

  const warnings = tradeoffs
    .filter(t => t.severity === 'high' || t.severity === 'critical')
    .map(t => t.explanation);

  return {
    tradeoffs,
    warnings,
    calibration,
    has_tradeoffs: tradeoffs.length > 0,
    summary: tradeoffs.length
      ? `${tradeoffs.length} פשרות זוהו: ${tradeoffs[0].explanation}`
      : 'לא זוהו פשרות מדאיגות',
  };
}

// ── Confidence calibration ─────────────────────────────────────────────────────

function _calibrateConfidence(unified, tradeoffs) {
  let baseConf = 0.70;

  if (unified.impressions > 10000) baseConf += 0.10;
  if (unified.conversions > 20)    baseConf += 0.10;
  if (unified.impressions < 500)   baseConf -= 0.20;
  if (unified.conversions < 3)     baseConf -= 0.15;
  if (tradeoffs.length > 2)        baseConf -= 0.05; // conflicting signals

  const confidence = Math.max(0.30, Math.min(0.95, baseConf));
  const level      = confidence >= 0.80 ? 'high' : confidence >= 0.60 ? 'medium' : 'low';
  const recommendation = level === 'high' ? 'בטוח לפעול' : level === 'medium' ? 'פעל בזהירות — אסוף יותר דאטה' : 'אל תפעל עדיין — אין מספיק דאטה';

  return { confidence: Math.round(confidence * 100) / 100, level, recommendation };
}

module.exports = { analyzeTradeoffs };
