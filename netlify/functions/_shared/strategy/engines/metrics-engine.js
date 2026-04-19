'use strict';
/**
 * strategy/engines/metrics-engine.js
 * Module 6 (Metrics Engine): KPIs per funnel stage.
 * Pure logic. Integrates revenue-calculator.js patterns for unit economics.
 */

// KPI benchmarks by product type
const BENCHMARKS = {
  service:  { ctr: 0.02, lp_conv: 0.15, lead_conv: 0.10, cpl_max: 150, cac_max: 500  },
  coaching: { ctr: 0.015, lp_conv: 0.12, lead_conv: 0.08, cpl_max: 200, cac_max: 800 },
  course:   { ctr: 0.025, lp_conv: 0.20, lead_conv: 0.05, cpl_max: 80,  cac_max: 300 },
  saas:     { ctr: 0.03, lp_conv: 0.25, lead_conv: 0.03, cpl_max: 50,  cac_max: 200  },
};

function buildMetrics({ productType, platforms }) {
  const b = BENCHMARKS[productType] || BENCHMARKS.course;

  return {
    exposure: {
      metric:    'חשיפות ו-Reach',
      kpi:       'CPM < 40₪',
      benchmark: 'CTR > ' + (b.ctr * 100).toFixed(1) + '%',
      platform:  platforms?.primary || 'facebook',
    },
    interest: {
      metric:    'עצירה וצפייה',
      kpi:       'Hook Rate > 30% (3 שניות ראשונות)',
      benchmark: 'Watch Rate > 25%',
    },
    trust: {
      metric:    'זמן בדף ומעורבות',
      kpi:       'Time on Page > 45 שניות',
      benchmark: 'LP Conversion > ' + (b.lp_conv * 100).toFixed(0) + '%',
    },
    action: {
      metric:    'לידים / הרשמות',
      kpi:       'Lead Conv > ' + (b.lead_conv * 100).toFixed(0) + '%',
      benchmark: 'CPL < ' + b.cpl_max + '₪',
    },
    payment: {
      metric:    'מכירות',
      kpi:       'CAC < ' + b.cac_max + '₪',
      benchmark: 'ROAS > 2.5x',
    },
    unitEconomics: {
      cplMax:  b.cpl_max,
      cacMax:  b.cac_max,
      minRoas: 2.5,
    },
  };
}

module.exports = { buildMetrics, BENCHMARKS };
