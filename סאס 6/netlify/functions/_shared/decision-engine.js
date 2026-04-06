/**
 * decision-engine.js — Ported from סוכן מוח 7 TypeScript engine
 *
 * Pipeline: rawMetrics → normalizeMetrics → computeMetrics → runDecisionEngine
 * Returns structured verdict, issues, and prioritized actions.
 * Zero external dependencies.
 */

'use strict';

// ── Config (from engineConfig.ts) ─────────────────────────────────────────────
const ENGINE_VERSION = '3.1.0';

const engineConfig = {
  thresholds: {
    ctrLow:                    0.012,
    ctrCritical:               0.008,
    conversionRateLow:         0.03,
    landingPageDropoffHigh:    0.35,
    sessionDropoffHigh:        0.25,
    checkoutDropoffHigh:       0.45,
    roasLow:                   1.5,
    frequencyHigh:             3.5,
    bounceRateHigh:            0.58,
    cpaHigh:                   80,
  },
  weights: {
    creative:    0.28,
    audience:    0.22,
    landingPage: 0.28,
    budget:      0.22,
  },
  actionPriority: {
    impactWeight:  0.50,
    effortWeight:  0.15,
    urgencyWeight: 0.35,
  },
};

// ── normalize.ts ──────────────────────────────────────────────────────────────
function safe(v) { return typeof v === 'number' && Number.isFinite(v) ? v : 0; }

function normalizeMetrics(raw) {
  return {
    impressions:       safe(raw.impressions),
    clicks:            safe(raw.clicks),
    spend:             safe(raw.spend),
    landingPageViews:  safe(raw.landingPageViews),
    sessions:          safe(raw.sessions),
    leads:             safe(raw.leads),
    purchases:         safe(raw.purchases),
    revenue:           safe(raw.revenue),
    frequency:         safe(raw.frequency),
    bounceRate:        safe(raw.bounceRate),
    addToCart:         safe(raw.addToCart),
    initiatedCheckout: safe(raw.initiatedCheckout),
  };
}

// ── metrics.ts ────────────────────────────────────────────────────────────────
function div(a, b) { return b > 0 ? a / b : 0; }

function computeMetrics(m) {
  const cpa  = m.leads > 0 ? m.spend / m.leads : (m.purchases > 0 ? m.spend / m.purchases : null);
  const roas = m.spend > 0 ? m.revenue / m.spend : null;
  return {
    ctr:                   div(m.clicks, m.impressions),
    cpc:                   div(m.spend,  m.clicks),
    cpa,
    roas,
    conversionRate:        div(m.leads || m.purchases, m.clicks),
    landingPageDropoffRate: m.clicks > 0 ? Math.max(0, 1 - div(m.landingPageViews, m.clicks)) : 0,
    sessionDropoffRate:    m.landingPageViews > 0 ? Math.max(0, 1 - div(m.sessions, m.landingPageViews)) : 0,
    checkoutDropoffRate:   m.initiatedCheckout > 0 ? Math.max(0, 1 - div(m.purchases, m.initiatedCheckout)) : 0,
  };
}

// ── decisionEngine.ts ─────────────────────────────────────────────────────────
function weightedSeverity(stage, base) {
  return Number((base * engineConfig.weights[stage]).toFixed(2));
}

const actionTemplates = {
  'Creative failure': {
    title:          'החלף את ערכת הקריאייטיב הנוכחית',
    why:            'אות כוונה חלש מצביע על חוסר התאמה בין המסר למודעה.',
    expectedImpact: 'CTR גבוה יותר ועלות לקליק נמוכה יותר.',
    impact: 9, effort: 5, urgency: 9,
  },
  'Audience mismatch': {
    title:          'הדק את הטרגטינג ואסוף את הסגמנטים העייפים',
    why:            'תדירות גבוהה עם תגובה חלשה מצביעה על רוויה בקהל.',
    expectedImpact: 'איכות תנועה גבוהה יותר ושיעור המרה טוב יותר.',
    impact: 8, effort: 4, urgency: 8,
  },
  'Landing page issue': {
    title:          'בנה מחדש את בהירות ההצעה above-the-fold',
    why:            'נטישה לפני עומק הסשן אומרת שהדף מדליף כוונה.',
    expectedImpact: 'פחות נטישה ויותר השלמות ליד.',
    impact: 10, effort: 6, urgency: 10,
  },
  'Budget inefficiency': {
    title:          'הקצה מחדש תקציב רק לסגמנטים יעילים',
    why:            'ההוצאה עולה על ה-Return המדיד.',
    expectedImpact: 'CPA נמוך יותר או ROAS משופר.',
    impact: 8, effort: 3, urgency: 8,
  },
};

function detectSignals(metrics, computed) {
  const signals = [];
  const t = engineConfig.thresholds;

  if (computed.ctr < t.ctrCritical) {
    signals.push({ code: 'creative_ctr_critical', verdictType: 'Creative failure', stage: 'creative',
      severity: weightedSeverity('creative', 95), confidence: 0.92,
      reason: 'CTR קריטי מתחת לסף.',
      evidence: [`CTR=${(computed.ctr * 100).toFixed(2)}%`, `סף=${(t.ctrCritical * 100).toFixed(2)}%`] });
  } else if (computed.ctr < t.ctrLow) {
    signals.push({ code: 'creative_ctr_low', verdictType: 'Creative failure', stage: 'creative',
      severity: weightedSeverity('creative', 70), confidence: 0.78,
      reason: 'CTR מתחת לרצועה הבריאה.',
      evidence: [`CTR=${(computed.ctr * 100).toFixed(2)}%`] });
  }

  if (metrics.frequency > t.frequencyHigh && computed.ctr < t.ctrLow) {
    signals.push({ code: 'audience_fatigue', verdictType: 'Audience mismatch', stage: 'audience',
      severity: weightedSeverity('audience', 82), confidence: 0.81,
      reason: 'תדירות גבוהה בעוד CTR נשאר חלש.',
      evidence: [`תדירות=${metrics.frequency.toFixed(2)}`, `CTR=${(computed.ctr * 100).toFixed(2)}%`] });
  }

  if (metrics.bounceRate > t.bounceRateHigh ||
      computed.landingPageDropoffRate > t.landingPageDropoffHigh ||
      computed.sessionDropoffRate     > t.sessionDropoffHigh) {
    signals.push({ code: 'landing_page_dropoff', verdictType: 'Landing page issue', stage: 'landing_page',
      severity: weightedSeverity('landingPage', 88), confidence: 0.86,
      reason: 'המשתמשים נוטשים לפני עומק סשן משמעותי.',
      evidence: [
        `נטישה=${(metrics.bounceRate * 100).toFixed(0)}%`,
        `נטישת דף=${(computed.landingPageDropoffRate * 100).toFixed(0)}%`,
      ] });
  }

  if ((computed.cpa !== null && computed.cpa > t.cpaHigh) ||
      (computed.roas !== null && computed.roas < t.roasLow)) {
    signals.push({ code: 'budget_efficiency', verdictType: 'Budget inefficiency', stage: 'budget',
      severity: weightedSeverity('budget', 84), confidence: 0.80,
      reason: 'מבנה העלויות אינו מוצדק על ידי התוצאות.',
      evidence: [
        computed.cpa  ? `CPA=$${computed.cpa.toFixed(0)}` : 'CPA=n/a',
        computed.roas ? `ROAS=${computed.roas.toFixed(2)}x` : 'ROAS=n/a',
      ] });
  }

  if (!signals.length) {
    signals.push({ code: 'healthy_campaign', verdictType: 'Budget inefficiency', stage: 'budget',
      severity: weightedSeverity('budget', 15), confidence: 0.66,
      reason: 'הקמפיין לא מציג דפוס כשל דומיננטי.',
      evidence: ['המדדים נשארו בתוך הסף המוגדר.'] });
  }

  return signals.sort((a, b) => b.severity - a.severity);
}

function buildActions(signals) {
  return signals.map((item, i) => {
    const base = actionTemplates[item.verdictType];
    const priority = base.impact * engineConfig.actionPriority.impactWeight
      + (10 - base.effort) * engineConfig.actionPriority.effortWeight
      + base.urgency       * engineConfig.actionPriority.urgencyWeight;
    return { code: `${item.code}_action_${i + 1}`, ...base, priorityScore: Number(priority.toFixed(2)) };
  }).sort((a, b) => b.priorityScore - a.priorityScore);
}

function runDecisionEngine(metrics, computed) {
  const issues    = detectSignals(metrics, computed);
  const top       = issues[0];
  const confidence = Number(Math.min(1, issues.reduce((s, i) => s + i.confidence, 0) / issues.length).toFixed(2));
  return {
    verdict:           top.verdictType,
    confidence,
    issues,
    computed,
    normalized:        metrics,
    prioritizedActions: buildActions(issues),
    engineVersion:     ENGINE_VERSION,
  };
}

// ── Full pipeline entry point ─────────────────────────────────────────────────
/**
 * @param {object} raw  — RawMetrics (all fields optional except impressions/clicks/spend)
 * @returns {object}    — EngineResult
 */
function analyze(raw) {
  const normalized = normalizeMetrics(raw);
  const computed   = computeMetrics(normalized);
  return runDecisionEngine(normalized, computed);
}

module.exports = { analyze, normalizeMetrics, computeMetrics, runDecisionEngine, engineConfig, ENGINE_VERSION };
