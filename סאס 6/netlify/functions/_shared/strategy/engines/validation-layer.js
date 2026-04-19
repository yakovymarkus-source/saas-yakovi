'use strict';
/**
 * strategy/engines/validation-layer.js
 * Module 7 (Validation Layer): 12 pre-flight checks per protocol.
 * FAIL if any critical check fails.
 * Also handles Coherence Check and System Fit.
 */

// ── 12 Pre-flight Checks ───────────────────────────────────────────────────────
function runValidation({ product, positioning, strategy, testPlan, metrics }) {
  const funnel  = strategy?.funnel  || {};
  const funnelComplete =
    !!(funnel.hook_strategy && funnel.conversion_method &&
       funnel.trust_builder  && funnel.offer_structure);

  const checks = {
    // ── Critical (4) ─────────────────────────────────────────────────────────
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
      label:   'יש בידול ברור',
      critical: true,
    },
    hasFunnelComplete: {
      pass:    funnelComplete,
      label:   'יש משפך שלם (hook + trust + offer + conversion)',
      critical: true,
    },
    // ── Important (non-critical) ──────────────────────────────────────────────
    hasCoreMessage: {
      pass:    !!(strategy?.coreMessage),
      label:   'יש מסר מרכזי',
      critical: false,
    },
    hasAngles: {
      pass:    (strategy?.angles?.length || 0) >= 3,
      label:   'יש 3+ זוויות שיווק',
      critical: false,
    },
    hasMarketingMethod: {
      pass:    !!(strategy?.method?.primary?.method),
      label:   'יש שיטת שיווק',
      critical: false,
    },
    hasTone: {
      pass:    !!(strategy?.tone?.tone),
      label:   'יש טון מוגדר',
      critical: false,
    },
    hasPlatform: {
      pass:    !!(strategy?.platforms?.primary),
      label:   'יש פלטפורמה ראשית',
      critical: false,
    },
    hasAssets: {
      pass:    (strategy?.assets?.required?.length || 0) > 0,
      label:   'יש נכסים מוגדרים',
      critical: false,
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
  const total         = Object.keys(checks).length;

  return {
    checks,
    passed,
    total,
    criticalFails,
    allFails,
    passed_pct:  Math.round((passed / total) * 100),
    status:      criticalFails.length === 0 ? 'PASS' : 'FAIL',
    canProceed:  criticalFails.length === 0,
  };
}

// ── Coherence Check ──────────────────────────────────────────────────────────
function checkCoherence({ method, tone, platforms, productType }) {
  const issues = [];

  if (method?.primary?.method === 'direct_response' && tone?.tone === 'authority') {
    issues.push({ type: 'tone_method_mismatch', description: 'שיטה אגרסיבית עם טון סמכותי — מומלץ: עבור לטון תקיף', severity: 'warning' });
  }
  if (['coaching','saas'].includes(productType) && platforms?.primary === 'tiktok') {
    issues.push({ type: 'platform_product_tension', description: 'מוצר מורכב על TikTok — מומלץ: הוסף YouTube כפלטפורמה ראשית', severity: 'info' });
  }
  if (method?.primary?.method === 'emotional_story' && platforms?.primary === 'google') {
    issues.push({ type: 'method_platform_tension', description: 'שיטה רגשית על Google Search — מומלץ: העבר ל-Meta/Instagram', severity: 'warning' });
  }

  return { issues, isCoherent: issues.filter(i => i.severity === 'error').length === 0 };
}

// ── System Fit Check ─────────────────────────────────────────────────────────
function checkSystemFit({ productType, platforms, assets }) {
  const fit = {
    resourcesMatch:     true,
    notPersonDependent: productType !== 'coaching' || (assets?.required || []).includes('sales_page'),
    scalable:           ['course', 'saas'].includes(productType),
    platformFit:        !!(platforms?.primary),
  };
  const score = Math.round(Object.values(fit).filter(Boolean).length / Object.keys(fit).length * 100);
  return { ...fit, score, isSystemFit: score >= 50 };
}

module.exports = { runValidation, checkCoherence, checkSystemFit };
