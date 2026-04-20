'use strict';
/**
 * analysis/output/output-builder.js
 * Builds the standardized analysis output schema (section 21 of protocol).
 * Also handles failure modes: no data, invalid data, KPI not defined (section 22).
 */

const { attachEndUserInsights } = require('../insights/end-user-translator');

/**
 * Build the final standardized output.
 * All analysis results flow through here.
 */
function buildAnalysisOutput({
  unified, kpiHierarchy, causality, anomalies, funnel,
  trends, attribution, businessLayer, experiments,
  alerts, insights, social, tradeoffs, patterns,
  priorityRanking, queryResult, aiNarrative,
  scores, integrity, brief,
}) {
  // ── Failure mode checks (section 22) ────────────────────────────────────────
  const failure = _checkFailureModes(unified, kpiHierarchy, integrity);
  if (failure) return failure;

  // ── Build uncertainty metadata ──────────────────────────────────────────────
  const uncertainty = _buildUncertainty(unified, tradeoffs, integrity);

  // ── Build system-thinking impact map ───────────────────────────────────────
  const systemImpact = _buildSystemImpact(unified, anomalies, tradeoffs);

  // ── Build agent feedback (execution sync) ──────────────────────────────────
  const agentFeedback = _buildEnrichedFeedback({
    anomalies, causality, kpiHierarchy, businessLayer, patterns, unified,
  });

  return {
    status:    'ok',
    version:   '2.0',
    generated_at: new Date().toISOString(),

    // ── Summary ──────────────────────────────────────────────────────────────
    summary: {
      score:           scores?.overall || 0,
      verdict:         scores?.verdict || 'unknown',
      goal:            brief?.goal || 'unknown',
      goal_verdict:    kpiHierarchy?.goal_verdict || 'unknown',
      top_action:      priorityRanking?.top_action?.action || null,
      narrative:       priorityRanking?.narrative || aiNarrative?.narrative || insights?.narrative || 'אין נרטיב',
      has_critical:    alerts?.has_critical || false,
      alert_count:     alerts?.total || 0,
      pattern_count:   patterns?.count || 0,
    },

    // ── Core metrics ─────────────────────────────────────────────────────────
    metrics: unified,

    // ── KPI layer ────────────────────────────────────────────────────────────
    kpi: kpiHierarchy,

    // ── Analysis layers ──────────────────────────────────────────────────────
    funnel:      funnel,
    trends:      trends,
    causality:   causality,
    anomalies:   anomalies,
    attribution: attribution,
    business:    businessLayer,
    social:      social,
    tradeoffs:   tradeoffs,
    patterns:    patterns,

    // ── Insights & decisions ─────────────────────────────────────────────────
    insights:    insights?.priorities || [],
    decisions:   _buildDecisionList(kpiHierarchy, anomalies, businessLayer),

    // ── Experiments ──────────────────────────────────────────────────────────
    experiments: experiments?.suggested || [],

    // ── Alerts ───────────────────────────────────────────────────────────────
    alerts:      alerts?.alerts || [],

    // ── Prioritized actions ───────────────────────────────────────────────────
    priority_actions: priorityRanking?.priority_list || [],

    // ── Agent feedback loops ──────────────────────────────────────────────────
    agent_feedback: agentFeedback,

    // ── Query answer ──────────────────────────────────────────────────────────
    query_result: queryResult || null,

    // ── AI narrative ─────────────────────────────────────────────────────────
    ai_narrative: aiNarrative || null,

    // ── Uncertainty handling ──────────────────────────────────────────────────
    uncertainty,

    // ── System thinking ───────────────────────────────────────────────────────
    system_impact: systemImpact,

    // ── Data quality ─────────────────────────────────────────────────────────
    integrity,
    scores,

    // ── End-user translated insights (שפה פשוטה למשתמש קצה) ──────────────────
    end_user_insights: attachEndUserInsights(
      { issues: insights?.priorities || [], findings: anomalies?.signals || [] },
      { business_type: brief?.businessProfile?.type || brief?.goal, user_level: 'beginner', display_mode: 'simple' }
    ).end_user_insights || null,
  };
}

// ── Failure modes ──────────────────────────────────────────────────────────────

function _checkFailureModes(unified, kpiHierarchy, integrity) {
  if (!unified || (!unified.impressions && !unified.clicks)) {
    return {
      status:  'no_data',
      error:   'אין נתוני פרסום',
      message: 'חבר אינטגרציות ל-Google Ads, Meta, או TikTok כדי לקבל ניתוח אמיתי',
      action:  'לחץ על "חיבורים" בתפריט ההגדרות',
    };
  }

  if (integrity && !integrity.passed && integrity.errors?.length) {
    const errs = integrity.errors.map(e => e.message).join(', ');
    return {
      status:  'invalid_data',
      error:   'נתונים לא תקינים',
      message: errs,
      action:  'בדוק חיבורי אינטגרציה ו-tracking',
    };
  }

  if (!kpiHierarchy?.goal) {
    return {
      status:  'kpi_not_defined',
      error:   'מטרת הקמפיין לא הוגדרה',
      message: 'בחר מטרה (לידים / מכירות / תוכן) כדי לקבל ניתוח KPI',
      action:  'הגדר מטרת קמפיין בטופס הניתוח',
    };
  }

  return null; // no failure
}

// ── Uncertainty handling ───────────────────────────────────────────────────────

function _buildUncertainty(unified, tradeoffs, integrity) {
  const base         = tradeoffs?.calibration?.confidence || 0.70;
  const dataSufficient = unified.impressions >= 1000 && unified.conversions >= 5;
  const note         = dataSufficient ? null : 'דאטה מוגבל — תוצאות ניתוח הן אומדן בלבד';

  return {
    confidence:       base,
    level:            tradeoffs?.calibration?.level || 'medium',
    data_sufficient:  dataSufficient,
    note,
    recommendation:   tradeoffs?.calibration?.recommendation || 'פעל בזהירות',
  };
}

// ── System thinking impact ─────────────────────────────────────────────────────

function _buildSystemImpact(unified, anomalies, tradeoffs) {
  const impacts = [];

  if (anomalies?.signals?.some(a => a.metric === 'ctr')) {
    impacts.push({ from: 'CTR', to: 'קליקים', direction: 'down', note: 'CTR נמוך → פחות קליקים → פחות המרות → ROAS יורד' });
  }
  if (tradeoffs?.tradeoffs?.some(t => t.id === 'scale_vs_efficiency')) {
    impacts.push({ from: 'תקציב', to: 'ROAS', direction: 'inverse', note: 'הגדלת תקציב → CPM עולה → ROAS יורד' });
  }
  if (unified.frequency > 3) {
    impacts.push({ from: 'תדירות', to: 'CTR', direction: 'down', note: 'תדירות גבוהה → עייפות קהל → CTR יורד → CPC עולה' });
  }

  return { impact_chains: impacts, note: 'כל שינוי קטן ב-A משפיע על B, C, D — ניתוח מערכתי' };
}

// ── Decision list ──────────────────────────────────────────────────────────────

function _buildDecisionList(kpiHierarchy, anomalies, businessLayer) {
  const decisions = [];

  if (kpiHierarchy?.goal_verdict === 'on_track') {
    decisions.push({ action: 'continue', reason: 'KPI ביעד', priority: 'medium', confidence: 85 });
  } else if (kpiHierarchy?.goal_verdict === 'off_track') {
    decisions.push({ action: 'optimize', reason: 'KPI לא מושג', priority: 'high', confidence: 80 });
  }

  if (anomalies?.severity === 'critical') {
    decisions.push({ action: 'pause_review', reason: anomalies.summary, priority: 'critical', confidence: 88 });
  }

  if (businessLayer?.scalability?.can_scale) {
    decisions.push({ action: 'scale', reason: 'יחסי LTV:CAC תומכים בסקייל', priority: 'medium', confidence: 75 });
  }

  return decisions;
}

// ── Agent feedback ─────────────────────────────────────────────────────────────

function _buildEnrichedFeedback({ anomalies, causality, kpiHierarchy, businessLayer, patterns, unified }) {
  const topPattern = patterns?.top_pattern;
  const topAnomaly = anomalies?.signals?.[0];
  const topChain   = causality?.chains?.[0];

  return {
    to_execution: topAnomaly && ['ctr_critically_low', 'clicks_without_conversions'].includes(topAnomaly.code) ? {
      signal:   topAnomaly.code,
      message:  topAnomaly.message,
      action:   topAnomaly.action,
      pattern:  topPattern?.name || null,
    } : null,

    to_strategy: kpiHierarchy?.goal_verdict === 'off_track' ? {
      signal:   'goal_off_track',
      message:  topChain ? `${topChain.change}: ${topChain.reason}` : 'יעדים לא מושגים',
      action:   topChain?.recommended_actions?.[0] || 'בחן מחדש אסטרטגיה',
      ltv_cac:  businessLayer?.unit_economics?.ltv_cac_ratio,
    } : null,

    to_qa: topPattern ? {
      signal:   'known_pattern',
      pattern:  topPattern.name,
      message:  topPattern.explanation,
      solution: topPattern.solution,
    } : null,

    execution_sync: {
      status:       'pending',
      last_checked: new Date().toISOString(),
      note:         'בדיקת ביצוע פעולות מומלצות — לא מאומת אוטומטית עדיין',
    },
  };
}

module.exports = { buildAnalysisOutput };
