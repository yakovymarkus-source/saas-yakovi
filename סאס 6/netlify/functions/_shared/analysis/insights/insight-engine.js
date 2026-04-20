'use strict';
/**
 * analysis/insights/insight-engine.js
 * Generates structured insights: { what, why, impact, confidence }
 * Operates on unified metrics, anomalies, causality chains, and KPI hierarchy.
 */

/**
 * @param {object} unified      — normalised metrics
 * @param {object} kpiHierarchy — from kpi-engine
 * @param {object} causality    — from causality-engine
 * @param {object} anomalies    — from anomaly-detector
 * @param {object} decisionResult — from decision-engine
 * @param {object} brief        — { goal, platform, businessProfile }
 * @returns {{ insights, priorities, narrative }}
 */
function generateInsights({ unified, kpiHierarchy, causality, anomalies, decisionResult, brief = {} }) {
  const insights = [];

  // ── Primary KPI insight ────────────────────────────────────────────────────
  const primaryKpi = kpiHierarchy?.primary;
  if (primaryKpi) {
    insights.push(_kpiInsight(primaryKpi, unified, brief));
  }

  // ── Anomaly insights ───────────────────────────────────────────────────────
  for (const anomaly of (anomalies?.signals || []).slice(0, 3)) {
    insights.push(_anomalyInsight(anomaly, unified));
  }

  // ── Causal insights ────────────────────────────────────────────────────────
  for (const chain of (causality?.chains || []).slice(0, 2)) {
    insights.push(_causalInsight(chain));
  }

  // ── Funnel insight (traffic → clicks → conversions) ────────────────────────
  const funnelInsight = _buildFunnelInsight(unified);
  if (funnelInsight) insights.push(funnelInsight);

  // ── Efficiency insight (ROAS / CPA) ───────────────────────────────────────
  const efficiencyInsight = _buildEfficiencyInsight(unified, brief);
  if (efficiencyInsight) insights.push(efficiencyInsight);

  // ── Signal vs noise filter ─────────────────────────────────────────────────
  const filtered = _filterNoise(insights, unified);

  // ── Priority ordering ─────────────────────────────────────────────────────
  const priorities = _prioritize(filtered);

  // ── Narrative ─────────────────────────────────────────────────────────────
  const narrative = _buildNarrative(priorities, kpiHierarchy, unified);

  return { insights: filtered, priorities, narrative };
}

// ── Individual insight builders ────────────────────────────────────────────────

function _kpiInsight(primaryKpi, unified, brief) {
  const val = primaryKpi.value;
  const status = primaryKpi.status;
  const isGood = ['excellent', 'on_target'].includes(status);

  return {
    id:         `kpi_${primaryKpi.key}`,
    category:   'kpi',
    what:       `${primaryKpi.label}: ${_formatValue(primaryKpi.key, val)}`,
    why:        isGood
      ? 'הקמפיין עומד ביעדי ה-KPI העיקריים שהוגדרו'
      : _kpiWhyMessage(primaryKpi.key, val, unified),
    impact:     isGood ? 'חיובי — המשך בכיוון הנוכחי' : _kpiImpactMessage(primaryKpi.key),
    confidence: 0.85,
    priority:   isGood ? 'medium' : 'high',
    sentiment:  isGood ? 'positive' : 'negative',
  };
}

function _anomalyInsight(anomaly, unified) {
  return {
    id:         `anomaly_${anomaly.code}`,
    category:   'anomaly',
    what:       anomaly.message,
    why:        _anomalyWhy(anomaly, unified),
    impact:     anomaly.action,
    confidence: 0.80,
    priority:   anomaly.priority,
    sentiment:  'negative',
  };
}

function _causalInsight(chain) {
  return {
    id:         `causal_${chain.metric}`,
    category:   'causality',
    what:       chain.change,
    why:        chain.reason,
    impact:     chain.impact,
    confidence: chain.confidence,
    priority:   chain.confidence >= 0.8 ? 'high' : 'medium',
    sentiment:  chain.change.includes('ירד') ? 'negative' : 'positive',
  };
}

function _buildFunnelInsight(unified) {
  if (!unified.impressions || !unified.clicks) return null;

  const ctr  = unified.ctr;
  const cr   = unified.conversion_rate;
  const bottleneck = ctr < 0.01 ? 'מודעה' : cr < 0.02 ? 'דף נחיתה' : null;

  if (!bottleneck) return null;

  return {
    id:         'funnel_bottleneck',
    category:   'funnel',
    what:       `צוואר הבקבוק במשפך: ${bottleneck}`,
    why:        bottleneck === 'מודעה'
      ? `CTR נמוך (${_pct(ctr)}) אומר שהמודעה לא מספיק רלוונטית`
      : `שיעור המרה נמוך (${_pct(cr)}) אומר שהדף לא ממיר תנועה`,
    impact:     `תיקון ${bottleneck} ישפר את כל שאר המדדים אחריו`,
    confidence: 0.83,
    priority:   'high',
    sentiment:  'negative',
  };
}

function _buildEfficiencyInsight(unified, brief) {
  if (!unified.cost || unified.cost === 0) return null;

  const roas = unified.roas;
  if (roas === null || roas === undefined) return null;

  const isEfficient = roas >= 2;
  return {
    id:         'efficiency_roas',
    category:   'economics',
    what:       `יעילות כלכלית: ROAS ${roas.toFixed(2)}x`,
    why:        isEfficient
      ? 'ההוצאה מניבה החזר חיובי — הקמפיין מייצר ערך'
      : 'ההוצאה גבוהה מההכנסה — הקמפיין פועל בהפסד',
    impact:     isEfficient
      ? `על כל ₪1 שהושקע, מתקבל ₪${roas.toFixed(1)} — הזדמנות לסקייל`
      : 'ממשיך לדמם כסף — נדרש אופטימיזציה מיידית',
    confidence: 0.88,
    priority:   isEfficient ? 'low' : 'critical',
    sentiment:  isEfficient ? 'positive' : 'negative',
  };
}

// ── Signal vs Noise filter ─────────────────────────────────────────────────────

function _filterNoise(insights, unified) {
  return insights.filter(ins => {
    // Remove insights with no data backing
    if (unified.impressions < 100 && ins.category !== 'kpi') return false;
    return true;
  });
}

// ── Priority ordering ──────────────────────────────────────────────────────────

const PRIORITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

function _prioritize(insights) {
  return [...insights].sort((a, b) => {
    const po = (PRIORITY_ORDER[a.priority] || 2) - (PRIORITY_ORDER[b.priority] || 2);
    if (po !== 0) return po;
    return b.confidence - a.confidence;
  });
}

// ── Narrative builder ──────────────────────────────────────────────────────────

function _buildNarrative(insights, kpiHierarchy, unified) {
  const critical = insights.filter(i => i.priority === 'critical');
  const high     = insights.filter(i => i.priority === 'high');

  if (critical.length) {
    return `⚠️ ${critical.length} בעיות קריטיות: ${critical[0].what}. דרושה פעולה מיידית.`;
  }
  if (high.length) {
    return `${high[0].what}. ${high[0].why}`;
  }

  const verdict = kpiHierarchy?.goal_verdict;
  if (verdict === 'on_track') return 'הקמפיין בביצועים תקינים — המשך לנטר ולחפש הזדמנויות לסקייל.';

  return 'הנתונים אינם מספיקים לניתוח מעמיק — חבר אינטגרציות נוספות לתמונה מלאה.';
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function _kpiWhyMessage(key, val, m) {
  if (key === 'cpl' || key === 'cpa') return `עלות גבוהה מהיעד — ייתכן תחרות מוגברת או טרגטינג רחב`;
  if (key === 'roas')  return `החזר על ההשקעה נמוך — ההוצאה גבוהה מההכנסה`;
  if (key === 'ctr')   return `קהל לא מגיב למסר — נדרש רענון קריאייטיב`;
  return 'ביצועים מתחת ליעד';
}

function _kpiImpactMessage(key) {
  if (key === 'cpl' || key === 'cpa') return 'כל ירידה ב-CPL משפרת ROI כולל';
  if (key === 'roas')  return 'ROAS מתחת ל-1x = הפסד כספי ישיר';
  if (key === 'ctr')   return 'CTR נמוך = עלות גבוהה יותר לכל קליק';
  return 'השפעה ישירה על יעילות הקמפיין';
}

function _anomalyWhy(anomaly, unified) {
  if (anomaly.code === 'ctr_critically_low')         return 'מסר המודעה לא רלוונטי לקהל שרואה אותה';
  if (anomaly.code === 'clicks_without_conversions') return 'פיקסל לא מוגדר, דף נחיתה שבור, או תנועת בוט';
  if (anomaly.code === 'audience_exhaustion')        return 'אותו אדם ראה את המודעה יותר מדי פעמים — עייפות';
  return 'דפוס חריג שדורש בדיקה';
}

function _formatValue(key, val) {
  if (val === null || val === undefined) return 'אין נתונים';
  if (['ctr', 'conversion_rate', 'engagement_rate'].includes(key)) return `${(val * 100).toFixed(2)}%`;
  if (['cpl', 'cpa', 'cpc', 'revenue', 'cost'].includes(key)) return `$${val.toFixed(2)}`;
  if (key === 'roas') return `${val.toFixed(2)}x`;
  return val.toString();
}

function _pct(v) { return `${(v * 100).toFixed(2)}%`; }

module.exports = { generateInsights };
