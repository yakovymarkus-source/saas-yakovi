/**
 * phase4g.unit.test.js — Unit tests for Phase 4G pure modules
 *
 * Tests only pure functions — zero DB, zero network.
 * Covers:
 *   - revenue-calculator: computeUnitEconomics, computeFunnelEconomics, simulateLaunch
 *   - business-profile:   scoreCompletion
 *   - ab-test-tracker:    validateTestInput (internal), buildNextTestSuggestion
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');

const {
  computeUnitEconomics,
  computeFunnelEconomics,
  simulateLaunch,
  cplStatusLabel,
  roasLabel,
  riskLabel,
} = require('../../netlify/functions/_shared/revenue-calculator');

const {
  scoreCompletion,
} = require('../../netlify/functions/_shared/business-profile');

const {
  buildNextTestSuggestion,
} = require('../../netlify/functions/_shared/ab-test-tracker');

// ═══════════════════════════════════════════════════════════════════════════════
// computeUnitEconomics
// ═══════════════════════════════════════════════════════════════════════════════

test('computeUnitEconomics — returns all nulls with no data', () => {
  const result = computeUnitEconomics({ businessProfile: {}, liveMetrics: {} });
  assert.equal(result.cpl,    null);
  assert.equal(result.cac,    null);
  assert.equal(result.roas,   null);
  assert.equal(result.cplStatus, null);
});

test('computeUnitEconomics — calculates CPL correctly', () => {
  const result = computeUnitEconomics({
    businessProfile: { price_amount: 1000, pricing_model: 'one_time' },
    liveMetrics:     { spend: 500, conversions: 10 },
  });
  assert.equal(result.cpl, 50);   // 500 / 10
  assert.equal(result.cac, 50);   // closeRate=1.0 → same as CPL
});

test('computeUnitEconomics — CAC accounts for close rate', () => {
  const result = computeUnitEconomics({
    businessProfile: { price_amount: 1000, pricing_model: 'one_time' },
    liveMetrics:     { spend: 500, conversions: 10 },
    closeRate:       0.5,
  });
  assert.equal(result.cpl, 50);
  assert.equal(result.cac, 100);  // 50 / 0.5
});

test('computeUnitEconomics — CPL status: profitable when cpl <= sustainableCPL', () => {
  // price=1000, one_time → ltv=1000, breakEven=1000, sustainable=600
  // cpl=50 < 600 → profitable
  const result = computeUnitEconomics({
    businessProfile: { price_amount: 1000, pricing_model: 'one_time' },
    liveMetrics:     { spend: 500, conversions: 10 },
  });
  assert.equal(result.breakEvenCPL,   1000);
  assert.equal(result.sustainableCPL, 600);
  assert.equal(result.cplStatus, 'profitable');
});

test('computeUnitEconomics — CPL status: marginal when cpl between sustainable and break-even', () => {
  // price=100, ltv=100, breakEven=100, sustainable=60
  // cpl=80 → between 60 and 100 → marginal
  const result = computeUnitEconomics({
    businessProfile: { price_amount: 100, pricing_model: 'one_time' },
    liveMetrics:     { spend: 800, conversions: 10 },  // cpl=80
  });
  assert.equal(result.cplStatus, 'marginal');
});

test('computeUnitEconomics — CPL status: losing when cpl > break-even', () => {
  // price=100, ltv=100, breakEven=100, sustainable=60
  // cpl=150 → losing
  const result = computeUnitEconomics({
    businessProfile: { price_amount: 100, pricing_model: 'one_time' },
    liveMetrics:     { spend: 1500, conversions: 10 },  // cpl=150
  });
  assert.equal(result.cplStatus, 'losing');
});

test('computeUnitEconomics — recurring pricing multiplies LTV by 3', () => {
  const result = computeUnitEconomics({
    businessProfile: { price_amount: 300, pricing_model: 'recurring' },
    liveMetrics:     { spend: 0, conversions: 0 },
  });
  assert.equal(result.ltv, 900);  // 300 × 3
});

test('computeUnitEconomics — paybackMonths only for recurring', () => {
  const result = computeUnitEconomics({
    businessProfile: { price_amount: 300, pricing_model: 'recurring' },
    liveMetrics:     { spend: 600, conversions: 10 },  // cpl=cac=60, ltv=900
    closeRate:       1.0,
  });
  // payback = ceil(60 / 300) = 1 month
  assert.equal(result.paybackMonths, 1);
});

test('computeUnitEconomics — no paybackMonths for one_time', () => {
  const result = computeUnitEconomics({
    businessProfile: { price_amount: 1000, pricing_model: 'one_time' },
    liveMetrics:     { spend: 500, conversions: 5 },
  });
  assert.equal(result.paybackMonths, null);
});

test('computeUnitEconomics — ROAS computed from spend and revenue', () => {
  const result = computeUnitEconomics({
    businessProfile: {},
    liveMetrics:     { spend: 1000, revenue: 3000 },
  });
  assert.equal(result.roas, 3);
});

test('computeUnitEconomics — margin computed correctly', () => {
  const result = computeUnitEconomics({
    businessProfile: {},
    liveMetrics:     { spend: 1000, revenue: 4000 },
  });
  // (4000 - 1000) / 4000 = 0.75
  assert.equal(result.margin, 0.75);
});

// ═══════════════════════════════════════════════════════════════════════════════
// computeFunnelEconomics
// ═══════════════════════════════════════════════════════════════════════════════

test('computeFunnelEconomics — returns nulls without price or targetRevenue', () => {
  const result = computeFunnelEconomics({
    targetRevenue:   null,
    businessProfile: { price_amount: null },
    liveMetrics:     {},
  });
  assert.equal(result.feasible, null);
  assert.equal(result.gap, null);
});

test('computeFunnelEconomics — correct backward calculation', () => {
  // target=10000, price=1000 → 10 sales, convRate=0.1 → 100 clicks, cpc=5 → budget=500
  const result = computeFunnelEconomics({
    targetRevenue:   10000,
    businessProfile: { price_amount: 1000, monthly_budget: 600 },
    liveMetrics:     { convRate: 0.1, ctr: 0.02, cpc: 5 },
    closeRate:       1.0,
  });
  assert.equal(result.salesNeeded,  10);
  assert.equal(result.leadsNeeded,  10);
  assert.equal(result.clicksNeeded, 100);
  assert.equal(result.budgetNeeded, 500);
  assert.equal(result.feasible,     true);
  assert.equal(result.gap,          null);
});

test('computeFunnelEconomics — detects infeasible when budget < needed', () => {
  const result = computeFunnelEconomics({
    targetRevenue:   10000,
    businessProfile: { price_amount: 1000, monthly_budget: 200 },  // only 200, need 500
    liveMetrics:     { convRate: 0.1, ctr: 0.02, cpc: 5 },
    closeRate:       1.0,
  });
  assert.equal(result.feasible, false);
  assert.equal(result.gap, 300);  // 500 - 200
});

test('computeFunnelEconomics — close rate reduces leads needed', () => {
  // 5 sales needed, closeRate=0.5 → 10 leads
  const result = computeFunnelEconomics({
    targetRevenue:   5000,
    businessProfile: { price_amount: 1000 },
    liveMetrics:     { convRate: 0.1, ctr: 0.02, cpc: 5 },
    closeRate:       0.5,
  });
  assert.equal(result.salesNeeded, 5);
  assert.equal(result.leadsNeeded, 10);
});

// ═══════════════════════════════════════════════════════════════════════════════
// simulateLaunch
// ═══════════════════════════════════════════════════════════════════════════════

test('simulateLaunch — uses defaults when no assumptions given', () => {
  const result = simulateLaunch({
    businessProfile: { price_amount: 500, pricing_model: 'one_time' },
  });
  assert.ok(result.totalSpend > 0);
  assert.ok(result.clicks > 0);
  assert.ok(typeof result.riskLevel === 'string');
  assert.ok(['low','medium','high','critical'].includes(result.riskLevel));
});

test('simulateLaunch — high price yields low risk with defaults', () => {
  // price=5000, ROAS should be very high with defaults → low risk
  const result = simulateLaunch({
    businessProfile: { price_amount: 5000, pricing_model: 'one_time' },
    assumptions:     { dailyBudget: 100, days: 7, estimatedCTR: 0.015, estimatedConvRate: 0.02, estimatedCPC: 5 },
  });
  assert.equal(result.riskLevel, 'low');
});

test('simulateLaunch — low price with high CPC yields high/critical risk', () => {
  // price=10, CPC=5, convRate=2% → extremely low ROAS
  const result = simulateLaunch({
    businessProfile: { price_amount: 10, pricing_model: 'one_time' },
    assumptions:     { dailyBudget: 100, days: 7, estimatedCTR: 0.015, estimatedConvRate: 0.02, estimatedCPC: 5 },
  });
  assert.ok(['high','critical'].includes(result.riskLevel));
});

test('simulateLaunch — returns all required fields', () => {
  const result = simulateLaunch({ businessProfile: { price_amount: 300 } });
  assert.ok('totalSpend'       in result);
  assert.ok('clicks'           in result);
  assert.ok('leads'            in result);
  assert.ok('sales'            in result);
  assert.ok('estimatedRevenue' in result);
  assert.ok('estimatedROAS'    in result);
  assert.ok('riskLevel'        in result);
  assert.ok('assumptions'      in result);
});

test('simulateLaunch — zero price still returns a result without crashing', () => {
  const result = simulateLaunch({ businessProfile: { price_amount: 0 } });
  assert.ok(result.riskLevel);
});

// ═══════════════════════════════════════════════════════════════════════════════
// scoreCompletion
// ═══════════════════════════════════════════════════════════════════════════════

test('scoreCompletion — returns 0% for null profile', () => {
  const { pct, missingRequired, missingEnrichment } = scoreCompletion(null);
  assert.equal(pct, 0);
  assert.equal(missingRequired.length, 6);   // all 6 required fields
  assert.equal(missingEnrichment.length, 6); // all 6 enrichment fields
});

test('scoreCompletion — returns 70 when only required fields filled', () => {
  const profile = {
    offer:           'שירותי פרסום',
    price_amount:    500,
    target_audience: 'עסקים קטנים',
    problem_solved:  'לא מקבלים לידים',
    desired_outcome: '10 לידים בשבוע',
    primary_goal:    'leads',
  };
  const { pct, missingRequired, missingEnrichment } = scoreCompletion(profile);
  assert.equal(pct, 70);
  assert.equal(missingRequired.length, 0);
  assert.ok(missingEnrichment.length > 0);
});

test('scoreCompletion — returns 100 when all fields filled', () => {
  const profile = {
    offer: 'x', price_amount: 1, target_audience: 'x', problem_solved: 'x',
    desired_outcome: 'x', primary_goal: 'leads',
    business_name: 'x', category: 'services', pricing_model: 'one_time',
    unique_mechanism: 'x', main_promise: 'x', monthly_budget: 1000,
  };
  const { pct } = scoreCompletion(profile);
  assert.equal(pct, 100);
});

test('scoreCompletion — partial required fields gives proportional score', () => {
  // 3 of 6 required filled → 35% (half of 70)
  const profile = {
    offer:          'something',
    price_amount:   100,
    target_audience: 'someone',
  };
  const { pct } = scoreCompletion(profile);
  assert.equal(pct, 35);
});

// ═══════════════════════════════════════════════════════════════════════════════
// buildNextTestSuggestion
// ═══════════════════════════════════════════════════════════════════════════════

test('buildNextTestSuggestion — returns null when all candidates already running', () => {
  const running = [
    { variable_name: 'headline' },
    { variable_name: 'hook' },
    { variable_name: 'creative' },
  ];
  const result = buildNextTestSuggestion(running, 'creative');
  assert.equal(result, null);
});

test('buildNextTestSuggestion — creative bottleneck suggests headline first', () => {
  const result = buildNextTestSuggestion([], 'creative');
  assert.ok(result);
  assert.equal(result.variable, 'headline');
  assert.ok(result.label);
  assert.ok(result.guidance);
});

test('buildNextTestSuggestion — landing_page bottleneck suggests cta first', () => {
  const result = buildNextTestSuggestion([], 'landing_page');
  assert.equal(result.variable, 'cta');
});

test('buildNextTestSuggestion — skips already-running variable', () => {
  // headline already running → should suggest hook or creative next
  const running = [{ variable_name: 'headline' }];
  const result  = buildNextTestSuggestion(running, 'creative');
  assert.ok(result.variable !== 'headline');
  assert.ok(['hook', 'creative'].includes(result.variable));
});

test('buildNextTestSuggestion — budget bottleneck suggests offer_framing', () => {
  const result = buildNextTestSuggestion([], 'budget');
  assert.equal(result.variable, 'offer_framing');
});

test('buildNextTestSuggestion — unknown bottleneck defaults to headline', () => {
  const result = buildNextTestSuggestion([], 'unknown_stage');
  assert.equal(result.variable, 'headline');
});

test('buildNextTestSuggestion — handles null runningTests gracefully', () => {
  const result = buildNextTestSuggestion(null, 'creative');
  assert.ok(result);
  assert.equal(result.variable, 'headline');
});

// ═══════════════════════════════════════════════════════════════════════════════
// Label helpers
// ═══════════════════════════════════════════════════════════════════════════════

test('cplStatusLabel — returns correct Hebrew labels', () => {
  assert.ok(cplStatusLabel('profitable').includes('רווחי'));
  assert.ok(cplStatusLabel('marginal').includes('גבולי'));
  assert.ok(cplStatusLabel('losing').includes('מפסיד'));
  assert.equal(cplStatusLabel('unknown'), '—');
});

test('roasLabel — tiers correct', () => {
  assert.ok(roasLabel(4).includes('מצוין'));
  assert.ok(roasLabel(2).includes('סביר'));
  assert.ok(roasLabel(1.2).includes('גבולי'));
  assert.ok(roasLabel(0.5).includes('מפסיד'));
  assert.equal(roasLabel(null), '—');
});

test('riskLabel — covers all levels', () => {
  assert.ok(riskLabel('low').includes('נמוך'));
  assert.ok(riskLabel('medium').includes('בינוני'));
  assert.ok(riskLabel('high').includes('גבוה'));
  assert.ok(riskLabel('critical').includes('קריטי'));
  assert.equal(riskLabel('unknown'), '—');
});
