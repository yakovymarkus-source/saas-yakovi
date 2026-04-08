'use strict';

/**
 * phase4g.economics-testing.unit.test.js
 *
 * Unit tests for Phase 4G pure functions.
 * Zero DB, zero network.
 *
 * Covers:
 *   revenue-calculator  — computeUnitEconomics, computeFunnelEconomics,
 *                         simulateLaunch, cplStatusLabel, roasLabel, riskLabel
 *   ab-test-tracker     — validateTestInput (via createTest shapes),
 *                         buildNextTestSuggestion, formatTestCard
 */

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
  buildNextTestSuggestion,
  formatTestCard,
  VARIABLE_LABELS,
  STATUS_LABELS,
  WINNER_LABELS,
} = require('../../netlify/functions/_shared/ab-test-tracker');

// ── Fixtures ───────────────────────────────────────────────────────────────────

const fullProfile = {
  offer:          'מכשיר לייזר ביתי',
  price_amount:   1500,
  pricing_model:  'one_time',
  primary_goal:   'leads',
  monthly_budget: 3000,
  test_budget:    500,
};

const recurringProfile = {
  offer:         'מנוי חודשי לתוכנה',
  price_amount:  200,
  pricing_model: 'recurring',
  monthly_budget: 5000,
};

const liveMetrics = {
  spend:       1000,
  clicks:      200,
  impressions: 20000,
  conversions: 10,
  revenue:     8000,
  ctr:         0.01,
  convRate:    0.05,
  cpc:         5,
  roas:        8,
};

// ═══════════════════════════════════════════════════════════════════════════════
// computeUnitEconomics
// ═══════════════════════════════════════════════════════════════════════════════

test('computeUnitEconomics — CPL = spend / conversions', () => {
  const ue = computeUnitEconomics({ businessProfile: fullProfile, liveMetrics });
  assert.equal(ue.cpl, 100);  // 1000 / 10
});

test('computeUnitEconomics — CAC equals CPL when closeRate=1', () => {
  const ue = computeUnitEconomics({ businessProfile: fullProfile, liveMetrics, closeRate: 1 });
  assert.equal(ue.cac, ue.cpl);
});

test('computeUnitEconomics — CAC inflated when closeRate < 1', () => {
  const ue = computeUnitEconomics({ businessProfile: fullProfile, liveMetrics, closeRate: 0.5 });
  assert.ok(ue.cac > ue.cpl, 'CAC must be higher than CPL when closeRate < 1');
  assert.equal(ue.cac, 200);  // 100 / 0.5
});

test('computeUnitEconomics — breakEvenCPL = price × closeRate', () => {
  const ue = computeUnitEconomics({ businessProfile: fullProfile, liveMetrics, closeRate: 1 });
  // breakEvenCPL = ltv * closeRate = 1500 * 1.0 = 1500
  assert.equal(ue.breakEvenCPL, 1500);
});

test('computeUnitEconomics — sustainableCPL = breakEven * 0.6', () => {
  const ue = computeUnitEconomics({ businessProfile: fullProfile, liveMetrics });
  assert.equal(ue.sustainableCPL, Math.round(ue.breakEvenCPL * 0.6 * 100) / 100);
});

test('computeUnitEconomics — cplStatus=profitable when cpl <= sustainableCPL', () => {
  // CPL=100, sustainableCPL=900 → profitable
  const ue = computeUnitEconomics({ businessProfile: fullProfile, liveMetrics });
  assert.equal(ue.cplStatus, 'profitable');
});

test('computeUnitEconomics — cplStatus=losing when cpl > breakEvenCPL', () => {
  const badMetrics = { ...liveMetrics, spend: 5000, conversions: 2, revenue: 1000 };
  // CPL = 2500, breakEvenCPL = 1500 → losing
  const ue = computeUnitEconomics({ businessProfile: fullProfile, liveMetrics: badMetrics });
  assert.equal(ue.cplStatus, 'losing');
});

test('computeUnitEconomics — cplStatus=marginal when between sustainable and breakEven', () => {
  // Make CPL=1200: spend=1200, conversions=1 → CPL=1200
  // breakEven=1500, sustainable=900 → marginal
  const marginalMetrics = { ...liveMetrics, spend: 1200, conversions: 1 };
  const ue = computeUnitEconomics({ businessProfile: fullProfile, liveMetrics: marginalMetrics });
  assert.equal(ue.cplStatus, 'marginal');
});

test('computeUnitEconomics — recurring: LTV = price * 3', () => {
  const ue = computeUnitEconomics({ businessProfile: recurringProfile, liveMetrics });
  assert.equal(ue.ltv, 600);  // 200 * 3
});

test('computeUnitEconomics — paybackMonths only for recurring', () => {
  const ueRecurring = computeUnitEconomics({ businessProfile: recurringProfile, liveMetrics });
  const ueOneTime   = computeUnitEconomics({ businessProfile: fullProfile,      liveMetrics });
  assert.ok(ueRecurring.paybackMonths !== null, 'recurring should have payback months');
  assert.equal(ueOneTime.paybackMonths, null,   'one_time should not have payback months');
});

test('computeUnitEconomics — ROAS = revenue / spend', () => {
  const ue = computeUnitEconomics({ businessProfile: fullProfile, liveMetrics });
  assert.equal(ue.roas, 8);  // 8000 / 1000
});

test('computeUnitEconomics — CPL null when no conversions', () => {
  const noConv = { ...liveMetrics, conversions: 0 };
  const ue = computeUnitEconomics({ businessProfile: fullProfile, liveMetrics: noConv });
  assert.equal(ue.cpl, null);
  assert.equal(ue.cplStatus, null);
});

test('computeUnitEconomics — works with empty inputs (no crash)', () => {
  assert.doesNotThrow(() => computeUnitEconomics({ businessProfile: {}, liveMetrics: {} }));
});

test('computeUnitEconomics — margin = (revenue - spend) / revenue', () => {
  const ue = computeUnitEconomics({ businessProfile: fullProfile, liveMetrics });
  // margin = (8000 - 1000) / 8000 = 0.875
  assert.equal(ue.margin, 0.88); // round2(0.875) = 0.88
});

// ═══════════════════════════════════════════════════════════════════════════════
// computeFunnelEconomics
// ═══════════════════════════════════════════════════════════════════════════════

test('computeFunnelEconomics — salesNeeded = ceil(targetRevenue / price)', () => {
  const fe = computeFunnelEconomics({
    targetRevenue: 15000, businessProfile: fullProfile, liveMetrics,
  });
  assert.equal(fe.salesNeeded, 10);  // ceil(15000/1500)
});

test('computeFunnelEconomics — leadsNeeded = salesNeeded when closeRate=1', () => {
  const fe = computeFunnelEconomics({
    targetRevenue: 15000, businessProfile: fullProfile, liveMetrics, closeRate: 1,
  });
  assert.equal(fe.leadsNeeded, fe.salesNeeded);
});

test('computeFunnelEconomics — leadsNeeded inflated when closeRate < 1', () => {
  const fe = computeFunnelEconomics({
    targetRevenue: 15000, businessProfile: fullProfile, liveMetrics, closeRate: 0.5,
  });
  assert.ok(fe.leadsNeeded > fe.salesNeeded);
});

test('computeFunnelEconomics — feasible=true when budgetNeeded <= monthly_budget', () => {
  // salesNeeded=10, leads=10, clicks=200 (convRate=0.05), budget=200*5=1000 < 3000
  const fe = computeFunnelEconomics({
    targetRevenue: 15000, businessProfile: fullProfile, liveMetrics,
  });
  assert.equal(fe.feasible, true);
});

test('computeFunnelEconomics — feasible=false and gap>0 when budget insufficient', () => {
  const bigTarget = computeFunnelEconomics({
    targetRevenue: 300000,
    businessProfile: { ...fullProfile, monthly_budget: 500 },
    liveMetrics,
  });
  assert.equal(bigTarget.feasible, false);
  assert.ok(bigTarget.gap > 0);
});

test('computeFunnelEconomics — returns null feasible when no monthly_budget', () => {
  const { monthly_budget: _, ...profileNoBudget } = fullProfile;
  const fe = computeFunnelEconomics({
    targetRevenue: 15000, businessProfile: profileNoBudget, liveMetrics,
  });
  assert.equal(fe.feasible, null);
});

test('computeFunnelEconomics — returns early when no price_amount', () => {
  const fe = computeFunnelEconomics({
    targetRevenue: 15000, businessProfile: {}, liveMetrics,
  });
  assert.equal(fe.salesNeeded, undefined);
  assert.equal(fe.feasible, null);
});

// ═══════════════════════════════════════════════════════════════════════════════
// simulateLaunch
// ═══════════════════════════════════════════════════════════════════════════════

test('simulateLaunch — returns all expected fields', () => {
  const sim = simulateLaunch({ businessProfile: fullProfile });
  const fields = ['totalSpend', 'clicks', 'leads', 'sales', 'estimatedRevenue', 'estimatedROAS', 'breakEven', 'riskLevel', 'assumptions'];
  for (const f of fields) {
    assert.ok(f in sim, `missing field: ${f}`);
  }
});

test('simulateLaunch — totalSpend = dailyBudget * days', () => {
  const sim = simulateLaunch({
    businessProfile: fullProfile,
    assumptions: { dailyBudget: 100, days: 7 },
  });
  assert.equal(sim.totalSpend, 700);
});

test('simulateLaunch — riskLevel=low when estimatedROAS >= 2', () => {
  // High price, low spend → ROAS high
  const sim = simulateLaunch({
    businessProfile: { ...fullProfile, price_amount: 10000 },
    assumptions: { dailyBudget: 50, days: 7, estimatedCTR: 0.02, estimatedConvRate: 0.05, estimatedCPC: 3 },
  });
  assert.equal(sim.riskLevel, 'low');
});

test('simulateLaunch — riskLevel=critical when estimatedROAS < 0.5', () => {
  const sim = simulateLaunch({
    businessProfile: { ...fullProfile, price_amount: 10 },
    assumptions: { dailyBudget: 500, days: 7, estimatedCTR: 0.001, estimatedConvRate: 0.001, estimatedCPC: 10 },
  });
  assert.equal(sim.riskLevel, 'critical');
});

test('simulateLaunch — uses conservative defaults when no assumptions given', () => {
  // Should not throw and should produce plausible output
  const sim = simulateLaunch({ businessProfile: fullProfile });
  assert.ok(sim.clicks > 0, 'should estimate clicks');
  assert.ok(['low', 'medium', 'high', 'critical'].includes(sim.riskLevel));
});

test('simulateLaunch — no crash with empty profile', () => {
  assert.doesNotThrow(() => simulateLaunch({ businessProfile: {} }));
});

// ═══════════════════════════════════════════════════════════════════════════════
// Hebrew verdict helpers
// ═══════════════════════════════════════════════════════════════════════════════

test('cplStatusLabel — returns correct Hebrew for each status', () => {
  assert.ok(cplStatusLabel('profitable').includes('רווחי'));
  assert.ok(cplStatusLabel('marginal').includes('גבולי'));
  assert.ok(cplStatusLabel('losing').includes('מפסיד'));
  assert.equal(cplStatusLabel(null), '—');
  assert.equal(cplStatusLabel('unknown'), '—');
});

test('roasLabel — thresholds correct', () => {
  assert.ok(roasLabel(5).includes('מצוין'));
  assert.ok(roasLabel(3).includes('סביר'));
  assert.ok(roasLabel(1.5).includes('גבולי'));
  assert.ok(roasLabel(0.5).includes('מפסיד'));
  assert.equal(roasLabel(null), '—');
});

test('riskLabel — all 4 levels covered', () => {
  assert.ok(riskLabel('low').includes('נמוך'));
  assert.ok(riskLabel('medium').includes('בינוני'));
  assert.ok(riskLabel('high').includes('גבוה'));
  assert.ok(riskLabel('critical').includes('קריטי'));
  assert.equal(riskLabel('unknown'), '—');
});

// ═══════════════════════════════════════════════════════════════════════════════
// buildNextTestSuggestion (ab-test-tracker pure function)
// ═══════════════════════════════════════════════════════════════════════════════

test('buildNextTestSuggestion — returns suggestion for creative bottleneck', () => {
  const suggestion = buildNextTestSuggestion([], 'creative');
  assert.ok(suggestion !== null);
  assert.ok(['headline', 'hook', 'creative'].includes(suggestion.variable));
  assert.ok(typeof suggestion.guidance === 'string');
  assert.ok(typeof suggestion.label === 'string');
});

test('buildNextTestSuggestion — returns suggestion for landing_page bottleneck', () => {
  const suggestion = buildNextTestSuggestion([], 'landing_page');
  assert.ok(['cta', 'offer_framing', 'landing_order'].includes(suggestion.variable));
});

test('buildNextTestSuggestion — skips variables already being tested', () => {
  const running = [
    { variable_name: 'headline' },
    { variable_name: 'hook' },
    { variable_name: 'creative' },
  ];
  // All creative bottleneck variables are taken
  const suggestion = buildNextTestSuggestion(running, 'creative');
  assert.equal(suggestion, null);
});

test('buildNextTestSuggestion — skips only already-running variable, not all', () => {
  const running = [{ variable_name: 'headline' }];
  const suggestion = buildNextTestSuggestion(running, 'creative');
  // headline is taken, so should suggest hook or creative
  assert.ok(suggestion !== null);
  assert.notEqual(suggestion.variable, 'headline');
});

test('buildNextTestSuggestion — works with unknown bottleneck (default fallback)', () => {
  const suggestion = buildNextTestSuggestion([], 'unknown_stage');
  assert.ok(suggestion !== null);
  assert.ok(['headline', 'hook'].includes(suggestion.variable));
});

test('buildNextTestSuggestion — null runningTests treated as empty', () => {
  assert.doesNotThrow(() => buildNextTestSuggestion(null, 'creative'));
  const suggestion = buildNextTestSuggestion(null, 'creative');
  assert.ok(suggestion !== null);
});

// ═══════════════════════════════════════════════════════════════════════════════
// formatTestCard (ab-test-tracker pure function)
// ═══════════════════════════════════════════════════════════════════════════════

const runningTest = {
  id:             'test-uuid-123',
  variable_name:  'headline',
  hypothesis:     'כותרת שאלה תביא יותר קליקים מכותרת הצהרה',
  control_value:  'קבל הצעת מחיר',
  variant_value:  'האם מחיר הלייזר פוגע בך?',
  start_date:     '2026-04-01',
  planned_days:   7,
  status:         'running',
  stop_condition: 'CTR יעלה ב-30% תוך 7 ימים',
  winner:         null,
  result_summary: null,
};

test('formatTestCard — includes variable label in Hebrew', () => {
  const card = formatTestCard(runningTest);
  assert.ok(card.includes('כותרת'), 'should include Hebrew label for headline');
});

test('formatTestCard — includes hypothesis', () => {
  const card = formatTestCard(runningTest);
  assert.ok(card.includes(runningTest.hypothesis));
});

test('formatTestCard — includes control and variant values', () => {
  const card = formatTestCard(runningTest);
  assert.ok(card.includes(runningTest.control_value));
  assert.ok(card.includes(runningTest.variant_value));
});

test('formatTestCard — includes stop_condition when present', () => {
  const card = formatTestCard(runningTest);
  assert.ok(card.includes('CTR יעלה ב-30%'));
});

test('formatTestCard — omits stop_condition line when null', () => {
  const noStop = { ...runningTest, stop_condition: null };
  const card = formatTestCard(noStop);
  assert.ok(!card.includes('תנאי עצירה'));
});

test('formatTestCard — shows winner label for concluded test', () => {
  const concluded = { ...runningTest, status: 'concluded', winner: 'variant', result_summary: 'CTR עלה ב-42%' };
  const card = formatTestCard(concluded);
  assert.ok(card.includes('הוריאציה ניצחה') || card.includes(WINNER_LABELS.variant));
  assert.ok(card.includes('CTR עלה ב-42%'));
});

test('formatTestCard — includes planned end date', () => {
  const card = formatTestCard(runningTest);
  // start=2026-04-01 + 7 days = 2026-04-08
  assert.ok(card.includes('2026'), 'should include year in end date');
});

// ═══════════════════════════════════════════════════════════════════════════════
// Label maps (ab-test-tracker)
// ═══════════════════════════════════════════════════════════════════════════════

test('VARIABLE_LABELS — has Hebrew for all 8 variable types', () => {
  const expected = ['headline', 'hook', 'creative', 'cta', 'offer_framing', 'audience', 'landing_order', 'copy'];
  for (const v of expected) {
    assert.ok(VARIABLE_LABELS[v], `Missing label for variable: ${v}`);
    assert.ok(typeof VARIABLE_LABELS[v] === 'string');
  }
});

test('STATUS_LABELS — has all 4 statuses', () => {
  const expected = ['running', 'paused', 'concluded', 'invalidated'];
  for (const s of expected) {
    assert.ok(STATUS_LABELS[s], `Missing label for status: ${s}`);
  }
});

test('WINNER_LABELS — has control, variant, inconclusive', () => {
  assert.ok(WINNER_LABELS.control);
  assert.ok(WINNER_LABELS.variant);
  assert.ok(WINNER_LABELS.inconclusive);
});
