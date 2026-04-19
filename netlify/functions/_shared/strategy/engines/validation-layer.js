'use strict';
/**
 * strategy/engines/validation-layer.js
 * Module 7 (Validation Layer): 6 checks. FAIL if any critical check fails.
 * Also handles Coherence Check and System Fit.
 */

// ── 6 Core Checks ─────────────────────────────────────────────────────────────
function runValidation({ product, positioning, strategy, testPlan, metrics }) {
  const checks = {
    hasClearPain: {
      pass:    !!(product?.selectedPain),
      label:   'יש כאב ברור',
      critical: true,
    },
    hasProduct: {
      pass:    !!(product?.productType && product?.outcome),
      label:   'יש מוצר מוגדר',
      critical: true,
    },
    hasDifferentiation: {
      pass:    !!(positioning?.selectedPositioning),
      label:   'יש בידול',
      critical: true,
    },
    hasFunnel: {
      pass:    !!(strategy?.funnel?.hook_strategy && strategy?.funnel?.conversion_method),
      label:   'יש משפך שלם',
      critical: true,
    },
    hasEconomicLogic: {
      pass:    !!(metrics?.payment?.kpi && product?.viabilityScore >= 50),
      label:   'יש היגיון כלכלי',
      critical: false,
    },
    hasTestPlan: {
      pass:    !!(testPlan?.hypotheses?.length > 0),
      label:   'יש תכנית בדיקות',
      critical: false,
    },
  };

  const criticalFails = Object.entries(checks).filter(([, c]) => c.critical && !c.pass).map(([k]) => k);
  const allFails      = Object.entries(checks).filter(([, c]) => !c.pass).map(([k]) => k);
  const passed        = Object.values(checks).filter(c => c.pass).length;

  return {
    checks,
    passed,
    total:         Object.keys(checks).length,
    criticalFails,
    allFails,
    passed_pct:    Math.round((passed / Object.keys(checks).length) * 100),
    status:        criticalFails.length === 0 ? 'PASS' : 'FAIL',
    canProceed:    criticalFails.length === 0,
  };
}

// ── Coherence Check ──────────────────────────────────────────────────────────
function checkCoherence({ method, tone, platforms, productType }) {
  const issues = [];

  // Direct response + educational tone = mismatch
  if (method?.primary?.method === 'direct_response' && tone?.tone === 'authority') {
    issues.push({ type: 'tone_method_mismatch', description: 'שיטה אגרסיבית עם טון סמכותי — מומלץ: עבור לטון תקיף', severity: 'warning' });
  }
  // Long-form product on TikTok = tension
  if (['coaching','saas'].includes(productType) && platforms?.primary === 'tiktok') {
    issues.push({ type: 'platform_product_tension', description: 'מוצר מורכב על TikTok — מומלץ: הוסף YouTube כפלטפורמה ראשית', severity: 'info' });
  }

  return { issues, isCoherent: issues.filter(i => i.severity === 'error').length === 0 };
}

// ── System Fit Check ─────────────────────────────────────────────────────────
function checkSystemFit({ productType, platforms, assets }) {
  const fit = {
    resourcesMatch: true,
    notPersonDependent: productType !== 'coaching' || assets?.required?.includes('sales_page'),
    scalable: ['course', 'saas'].includes(productType),
  };
  return {
    ...fit,
    score: Object.values(fit).filter(Boolean).length / Object.keys(fit).length * 100,
  };
}

module.exports = { runValidation, checkCoherence, checkSystemFit };
