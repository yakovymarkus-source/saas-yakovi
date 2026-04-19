'use strict';
/**
 * strategy/engines/decision-layer.js
 * Modules 8–16 combined:
 *   Trade-off Engine, Scalability Check, Risk Assessment,
 *   Reality Check inputs, Decision Layer, Iteration Trigger, Stop Conditions.
 * Pure logic — no AI calls.
 */

// ── Trade-off Engine ─────────────────────────────────────────────────────────
function evaluateTradeoffs({ product, positioning, competitorCount }) {
  const tradeoffs = [];

  // Strong pain vs high competition
  if (product.selectedPainScore >= 75 && competitorCount >= 8) {
    tradeoffs.push({
      dimension:  'כאב חזק vs תחרות גבוהה',
      choice:     'proceed',
      rationale:  'כאב חזק מצדיק כניסה גם בשוק תחרותי — הבידול הוא המפתח',
      risk:       'medium',
    });
  }
  // Sharp positioning vs market understanding
  if (positioning.positionScore >= 80) {
    tradeoffs.push({
      dimension:  'בידול חד vs הבנה רחבה',
      choice:     'keep_sharp',
      rationale:  'בידול חד נבחר — אל תרכך אותו לצורך "הבנה" רחבה יותר',
      risk:       'low',
    });
  }
  // Narrow audience vs high conversion
  tradeoffs.push({
    dimension:  'קהל מצומצם vs המרה גבוהה',
    choice:     'narrow_audience',
    rationale:  'קהל מצומצם עם כאב חד ממיר טוב יותר מקהל רחב עם כאב דיפוזי',
    risk:       'low',
  });

  return tradeoffs;
}

// ── Scalability Check ────────────────────────────────────────────────────────
function checkScalability({ productType, strategy }) {
  const checks = {
    notPersonDependent:  !['coaching','service'].includes(productType) || !!(strategy?.funnel?.conversion_method?.includes('אוטומטי')),
    replicable:          ['course','saas'].includes(productType),
    metricsTracked:      !!(strategy?.metrics),
    testPlanExists:      !!(strategy?.testPlan),
  };
  const score = Math.round(Object.values(checks).filter(Boolean).length / Object.keys(checks).length * 100);
  return { checks, score, isScalable: score >= 50 };
}

// ── Risk Assessment ──────────────────────────────────────────────────────────
function assessRisks({ product, positioning, competitorCount, viabilityScore }) {
  const risks = [];

  if (viabilityScore < 50) {
    risks.push({ type: 'low_viability', description: 'ציון כדאיות נמוך — לאמת ביקוש לפני השקעה', severity: 'high' });
  }
  if (competitorCount < 2) {
    risks.push({ type: 'no_market', description: 'פחות מ-2 מתחרים — ייתכן שאין שוק מוכח', severity: 'high' });
  }
  if (!positioning?.selectedPositioning) {
    risks.push({ type: 'no_differentiation', description: 'אין בידול ברור — מוצר לא יבלוט', severity: 'high' });
  }
  if (product?.productType === 'saas' && viabilityScore < 70) {
    risks.push({ type: 'saas_complexity', description: 'SaaS דורש השקעה גבוהה — ודא ביקוש חזק לפני פיתוח', severity: 'medium' });
  }

  return risks;
}

// ── Reality Check inputs ─────────────────────────────────────────────────────
function buildRealityCheckContext({ product, positioning, strategy }) {
  return {
    product:    product?.productType,
    pain:       product?.selectedPain,
    outcome:    product?.outcome,
    positioning: positioning?.selectedPositioning,
    coreMessage: strategy?.coreMessage,
    viability:  product?.viabilityScore,
  };
}

// ── Iteration Triggers ───────────────────────────────────────────────────────
const ITERATION_TRIGGERS = [
  { trigger: 'validation_fail',     action: 'switch_pain',       description: 'נכשלה בדיקת Validation — החלף כאב' },
  { trigger: 'low_viability',       action: 'switch_pain',       description: 'כדאיות נמוכה — נסה כאב גיבוי' },
  { trigger: 'no_differentiation',  action: 'rebuild_positioning',description: 'אין בידול — בנה positioning מחדש' },
  { trigger: 'reality_check_fail',  action: 'switch_angle',      description: 'Reality Check נכשל — החלף זווית' },
  { trigger: 'poor_conversion',     action: 'switch_funnel',     description: 'המרה נמוכה — שנה מבנה משפך' },
];

function getIterationAction(trigger) {
  return ITERATION_TRIGGERS.find(t => t.trigger === trigger) || null;
}

// ── Stop Conditions ──────────────────────────────────────────────────────────
function checkStopConditions({ product, positioning, strategy, validation, realityCheckPassed }) {
  return {
    hasValidProduct:   !!(product?.productType && product?.outcome),
    hasClearPositioning: !!(positioning?.selectedPositioning),
    hasCompleteFunnel: !!(strategy?.funnel?.hook_strategy && strategy?.funnel?.conversion_method),
    validationPassed:  validation?.status === 'PASS',
    realityCheckPassed: !!realityCheckPassed,
    canStop: !!(product?.productType && product?.outcome && positioning?.selectedPositioning &&
               strategy?.funnel?.hook_strategy && validation?.status === 'PASS'),
  };
}

// ── Final Decision ───────────────────────────────────────────────────────────
function makeDecision({ product, positioning, strategy, validation, risks }) {
  const criticalRisks = risks.filter(r => r.severity === 'high');
  if (!validation?.canProceed || criticalRisks.length > 0) {
    return {
      decision:   'RETRY',
      reason:     criticalRisks[0]?.description || validation?.criticalFails[0] || 'validation failed',
      confidence: 20,
    };
  }
  const confidence = Math.round(
    (product?.viabilityScore || 50) * 0.30 +
    (positioning?.positionScore || 50) * 0.30 +
    (validation?.passed_pct || 50) * 0.40
  );
  return {
    decision:   'PROCEED',
    product:    product?.productType,
    positioning: positioning?.selectedPositioning,
    coreMessage: strategy?.coreMessage,
    confidence,
  };
}

module.exports = {
  evaluateTradeoffs, checkScalability, assessRisks,
  buildRealityCheckContext, getIterationAction, checkStopConditions, makeDecision,
  ITERATION_TRIGGERS,
};
