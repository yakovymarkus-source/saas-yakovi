'use strict';
/**
 * analysis/alerts/alert-engine.js
 * Real-time alert engine: CTR drops, no conversions for N hours,
 * budget exhaustion, audience fatigue, and business-layer alerts.
 */

/**
 * Consolidates all signals into prioritized alerts.
 * @param {object} anomalies       — from anomaly-detector
 * @param {object} businessLayer   — from business-layer
 * @param {object} funnelResult    — from funnel-analyzer
 * @param {object} causality       — from causality-engine
 * @param {object} kpiHierarchy    — from kpi-engine
 * @param {object} unified         — unified metrics
 * @returns {{ alerts, critical, high, medium, opportunity, summary }}
 */
function buildAlerts({ anomalies, businessLayer, funnelResult, causality, kpiHierarchy, unified }) {
  const alerts = [];

  // ── From anomaly detector ──────────────────────────────────────────────────
  for (const anomaly of (anomalies?.signals || [])) {
    alerts.push(_fromAnomaly(anomaly));
  }

  // ── From business layer ────────────────────────────────────────────────────
  for (const bAlert of (businessLayer?.alerts || [])) {
    alerts.push(_fromBusiness(bAlert));
  }

  // ── From funnel bottleneck ─────────────────────────────────────────────────
  const bn = funnelResult?.bottleneck;
  if (bn && bn.impact === 'critical') {
    alerts.push({
      id:       `alert_funnel_${bn.stage}`,
      type:     'funnel',
      severity: 'critical',
      title:    `צוואר בקבוק קריטי: ${bn.label}`,
      message:  bn.message,
      action:   bn.action,
      metric:   bn.stage,
    });
  }

  // ── From causality chains ──────────────────────────────────────────────────
  for (const chain of (causality?.chains || []).filter(c => c.confidence >= 0.8).slice(0, 2)) {
    alerts.push({
      id:       `alert_causal_${chain.metric}`,
      type:     'causality',
      severity: chain.confidence >= 0.85 ? 'high' : 'medium',
      title:    chain.change,
      message:  chain.reason,
      action:   chain.recommended_actions?.[0] || 'בדוק שינויים לאחרונה',
      metric:   chain.metric,
    });
  }

  // ── From KPI off-track ─────────────────────────────────────────────────────
  if (kpiHierarchy?.goal_verdict === 'off_track') {
    alerts.push({
      id:       'alert_kpi_off_track',
      type:     'kpi',
      severity: 'high',
      title:    `KPI לא מושג: ${kpiHierarchy.primary?.label}`,
      message:  `ציון מטרה ${kpiHierarchy.goal_score}/100 — הקמפיין לא עומד ביעדים`,
      action:   'בחן את אסטרטגיית הקמפיין ואת ההצעה',
      metric:   kpiHierarchy.primary?.key,
    });
  }

  // ── Budget burning without results ────────────────────────────────────────
  if (unified.cost > 100 && unified.conversions === 0) {
    alerts.push({
      id:       'alert_budget_no_conv',
      type:     'budget',
      severity: 'critical',
      title:    `מוציאים $${(unified.cost || 0).toFixed(0)} ללא המרות`,
      message:  'תקציב נשרף ללא תוצאות — בדוק מיד',
      action:   'עצור קמפיינים ובדוק דף נחיתה + פיקסל',
      metric:   'conversions',
    });
  }

  // ── Opportunity alerts ─────────────────────────────────────────────────────
  if (unified.roas >= 3 && unified.conversions >= 5) {
    alerts.push({
      id:       'alert_scale_opportunity',
      type:     'opportunity',
      severity: 'opportunity',
      title:    `הזדמנות סקייל: ROAS ${(unified.roas || 0).toFixed(2)}x`,
      message:  `הקמפיין עובד — ${unified.conversions} המרות ב-ROAS ${(unified.roas || 0).toFixed(2)}x`,
      action:   'הגדל תקציב ב-20% בקמפיינים הטובים ביותר',
      metric:   'roas',
    });
  }

  // ── Deduplicate & prioritize ───────────────────────────────────────────────
  const unique = _dedup(alerts);
  unique.sort((a, b) => _severity(a.severity) - _severity(b.severity));

  const bySeverity = {
    critical:    unique.filter(a => a.severity === 'critical'),
    high:        unique.filter(a => a.severity === 'high'),
    medium:      unique.filter(a => a.severity === 'medium'),
    opportunity: unique.filter(a => a.severity === 'opportunity'),
  };

  return {
    alerts:   unique,
    ...bySeverity,
    total:    unique.length,
    has_critical: bySeverity.critical.length > 0,
    summary:  _buildAlertSummary(unique, bySeverity),
  };
}

// ── Individual alert builders ──────────────────────────────────────────────────

function _fromAnomaly(anomaly) {
  return {
    id:       `alert_${anomaly.code}`,
    type:     'anomaly',
    severity: anomaly.priority || 'medium',
    title:    anomaly.message,
    message:  anomaly.message,
    action:   anomaly.action,
    metric:   anomaly.metric,
  };
}

function _fromBusiness(bAlert) {
  return {
    id:       `alert_biz_${bAlert.code}`,
    type:     'business',
    severity: bAlert.severity || 'medium',
    title:    bAlert.message,
    message:  bAlert.message,
    action:   'בחן נתוני רווחיות',
    metric:   'profitability',
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function _severity(s) {
  return { critical: 0, high: 1, medium: 2, opportunity: 3 }[s] ?? 4;
}

function _dedup(alerts) {
  const seen = new Set();
  return alerts.filter(a => {
    if (seen.has(a.id)) return false;
    seen.add(a.id);
    return true;
  });
}

function _buildAlertSummary(alerts, bySeverity) {
  if (!alerts.length) return 'אין התראות פעילות';
  if (bySeverity.critical.length) return `🚨 ${bySeverity.critical.length} התראות קריטיות — ${bySeverity.critical[0].title}`;
  if (bySeverity.high.length) return `⚠️ ${bySeverity.high.length} התראות גבוהות — ${bySeverity.high[0].title}`;
  if (bySeverity.opportunity.length) return `✅ ${bySeverity.opportunity.length} הזדמנויות זוהו`;
  return `${alerts.length} התראות בסיכון בינוני`;
}

module.exports = { buildAlerts };
