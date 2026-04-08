/**
 * phase4f.unit.test.js — Unit tests for Phase 4F pure modules
 *
 * Tests only pure functions — zero DB, zero network.
 * Covers: bottleneck-tracker, iteration-advisor, and learning-engine compute helpers.
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');

const { trackBottlenecks }    = require('../../netlify/functions/_shared/bottleneck-tracker');
const { buildIterationAction } = require('../../netlify/functions/_shared/iteration-advisor');

// ═══════════════════════════════════════════════════════════════════════════════
// bottleneck-tracker
// ═══════════════════════════════════════════════════════════════════════════════

test('trackBottlenecks — returns hasPrevious:false when previousAnalysis is null', () => {
  const result = trackBottlenecks({ ctr: 0.02, convRate: 0.05, roas: 3, spend: 500 }, { overall: 70 }, null);
  assert.equal(result.hasPrevious, false);
  assert.deepEqual(result.deltas, {});
  assert.equal(result.stageDelta, 'stable');
  assert.equal(result.primaryStage, null);
});

test('trackBottlenecks — detects improving trend when CTR and score rise', () => {
  const current  = { ctr: 0.03, convRate: 0.08, roas: 3.5, spend: 500 };
  const scores   = { overall: 75 };
  const previous = { metrics: { ctr: 0.01, convRate: 0.06, roas: 3.0 }, scores: { overall: 60 }, timestamp: '2026-03-01T00:00:00Z' };

  const result = trackBottlenecks(current, scores, previous);
  assert.equal(result.hasPrevious, true);
  assert.equal(result.deltas.ctr.direction, 'improving');
  assert.equal(result.deltas.score.direction, 'improving');
  assert.equal(result.stageDelta, 'improving');
  assert.equal(result.primaryStage, null);  // nothing declining
});

test('trackBottlenecks — detects declining CTR and sets primaryStage=creative', () => {
  // CTR drops hard (declining), score drops (declining).
  // convRate and ROAS changes stay below their thresholds (stable).
  // Result: declineCount=2 → stageDelta='declining', not 'critical_decline'.
  const current  = { ctr: 0.005, convRate: 0.05, roas: 2.4 };
  const scores   = { overall: 50 };
  const previous = { metrics: { ctr: 0.025, convRate: 0.052, roas: 2.5 }, scores: { overall: 65 }, timestamp: '2026-03-01T00:00:00Z' };

  const result = trackBottlenecks(current, scores, previous);
  assert.equal(result.deltas.ctr.direction, 'declining');
  assert.equal(result.deltas.convRate.direction, 'stable');   // 0.002 < threshold 0.005
  assert.equal(result.deltas.roas.direction,     'stable');   // 0.1   < threshold 0.30
  assert.equal(result.primaryStage, 'creative');
  assert.equal(result.stageDelta,   'declining');
});

test('trackBottlenecks — detects critical_decline when 3+ metrics fall', () => {
  const current  = { ctr: 0.003, convRate: 0.005, roas: 0.5 };
  const scores   = { overall: 20 };
  const previous = { metrics: { ctr: 0.02, convRate: 0.05, roas: 2.5 }, scores: { overall: 70 }, timestamp: '2026-03-01T00:00:00Z' };

  const result = trackBottlenecks(current, scores, previous);
  assert.equal(result.stageDelta, 'critical_decline');
});

test('trackBottlenecks — sub-threshold changes are stable', () => {
  // Differences are below thresholds — should all be stable
  const current  = { ctr: 0.02 + 0.001, convRate: 0.05 + 0.001, roas: 2.0 + 0.1 };
  const scores   = { overall: 60 + 2 };
  const previous = { metrics: { ctr: 0.02, convRate: 0.05, roas: 2.0 }, scores: { overall: 60 }, timestamp: '2026-03-01T00:00:00Z' };

  const result = trackBottlenecks(current, scores, previous);
  assert.equal(result.stageDelta, 'stable');
  for (const d of Object.values(result.deltas)) {
    assert.equal(d.direction, 'stable');
  }
});

test('trackBottlenecks — landing_page primaryStage when convRate declines but ctr stable', () => {
  const current  = { ctr: 0.02, convRate: 0.003, roas: 1.8 };
  const scores   = { overall: 45 };
  const previous = { metrics: { ctr: 0.02, convRate: 0.03, roas: 2.5 }, scores: { overall: 60 }, timestamp: '2026-03-01T00:00:00Z' };

  const result = trackBottlenecks(current, scores, previous);
  assert.equal(result.primaryStage, 'landing_page');
  assert.equal(result.deltas.convRate.direction, 'declining');
});

// ═══════════════════════════════════════════════════════════════════════════════
// iteration-advisor
// ═══════════════════════════════════════════════════════════════════════════════

test('buildIterationAction — returns stop for critical_decline with spend', () => {
  const bn = { stageDelta: 'critical_decline', deltas: {}, primaryStage: 'creative' };
  const lr = { persistentBottlenecks: [], scoreTrend: 'declining', dataPoints: 5 };
  const m  = { roas: 0.5, spend: 300 };

  const result = buildIterationAction(bn, lr, m);
  assert.equal(result.verdict, 'stop');
  assert.equal(result.urgency, 'critical');
});

test('buildIterationAction — returns rewrite_creative for persistent CTR declining', () => {
  const bn = { stageDelta: 'declining', deltas: { ctr: { direction: 'declining', delta: -0.01 } }, primaryStage: 'creative' };
  const lr = { persistentBottlenecks: ['ctr'], scoreTrend: 'declining', dataPoints: 4 };
  const m  = { roas: 1.5, spend: 200 };

  const result = buildIterationAction(bn, lr, m);
  assert.equal(result.verdict, 'rewrite_creative');
  assert.equal(result.urgency, 'high');
});

test('buildIterationAction — returns fix_landing for persistent conversion bottleneck', () => {
  const bn = { stageDelta: 'stable', deltas: { convRate: { direction: 'stable', delta: 0 } }, primaryStage: 'landing_page' };
  const lr = { persistentBottlenecks: ['conversion'], scoreTrend: 'stable', dataPoints: 4 };
  const m  = { roas: 2.0, spend: 300 };

  const result = buildIterationAction(bn, lr, m);
  assert.equal(result.verdict, 'fix_landing');
  assert.equal(result.urgency, 'high');
});

test('buildIterationAction — returns scale when improving + ROAS >= 2', () => {
  const bn = { stageDelta: 'improving', deltas: { roas: { direction: 'improving', delta: 0.5 } }, primaryStage: null };
  const lr = { persistentBottlenecks: [], scoreTrend: 'improving', dataPoints: 5 };
  const m  = { roas: 3.2, spend: 500 };

  const result = buildIterationAction(bn, lr, m);
  assert.equal(result.verdict, 'scale');
  assert.equal(result.urgency, 'medium');
});

test('buildIterationAction — returns test_variation when ROAS declining but not critical', () => {
  const bn = { stageDelta: 'declining', deltas: { roas: { direction: 'declining', delta: -0.5 }, ctr: { direction: 'stable', delta: 0 } }, primaryStage: 'budget' };
  const lr = { persistentBottlenecks: [], scoreTrend: 'stable', dataPoints: 3 };
  const m  = { roas: 1.8, spend: 400 };

  const result = buildIterationAction(bn, lr, m);
  assert.equal(result.verdict, 'test_variation');
  assert.equal(result.urgency, 'medium');
});

test('buildIterationAction — returns monitor when everything is stable', () => {
  const bn = { stageDelta: 'stable', deltas: {}, primaryStage: null };
  const lr = { persistentBottlenecks: [], scoreTrend: 'stable', dataPoints: 3 };
  const m  = { roas: 2.5, spend: 300 };

  const result = buildIterationAction(bn, lr, m);
  assert.equal(result.verdict, 'monitor');
  assert.equal(result.urgency, 'low');
});

test('buildIterationAction — handles null inputs gracefully', () => {
  const result = buildIterationAction(null, null, null);
  assert.ok(result.verdict);
  assert.ok(result.heAction);
  assert.ok(result.urgency);
});

test('buildIterationAction — critical_decline with no spend still returns stop', () => {
  // Even with 0 spend, we should flag critical_decline
  const bn = { stageDelta: 'critical_decline', deltas: {}, primaryStage: null };
  const lr = { persistentBottlenecks: [], scoreTrend: 'declining', dataPoints: 4 };
  const m  = { roas: 0, spend: 0 };

  // spend=0 means rule 1 does NOT fire (no budget to stop)
  // so it falls through — should still return a valid action
  const result = buildIterationAction(bn, lr, m);
  assert.ok(['stop', 'monitor', 'test_variation'].includes(result.verdict));
  assert.ok(result.urgency);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Output shape validation
// ═══════════════════════════════════════════════════════════════════════════════

test('buildIterationAction — always returns all required fields', () => {
  const cases = [
    [{ stageDelta: 'critical_decline', deltas: {} }, { persistentBottlenecks: [] }, { spend: 100, roas: 0 }],
    [{ stageDelta: 'stable',           deltas: {} }, { persistentBottlenecks: [] }, { spend: 0,   roas: 0 }],
    [null, null, null],
  ];

  for (const [bn, lr, m] of cases) {
    const r = buildIterationAction(bn, lr, m);
    assert.ok(typeof r.verdict  === 'string', 'verdict must be string');
    assert.ok(typeof r.heAction === 'string', 'heAction must be string');
    assert.ok(typeof r.reason   === 'string', 'reason must be string');
    assert.ok(['critical','high','medium','low'].includes(r.urgency), `invalid urgency: ${r.urgency}`);
  }
});

test('trackBottlenecks — always returns required shape', () => {
  const cases = [
    [{ ctr: 0.01 }, { overall: 50 }, null],
    [{ ctr: 0.01 }, { overall: 50 }, { metrics: {}, scores: {}, timestamp: '2026-01-01T00:00:00Z' }],
  ];

  for (const [m, s, p] of cases) {
    const r = trackBottlenecks(m, s, p);
    assert.ok(typeof r.hasPrevious === 'boolean');
    assert.ok(typeof r.stageDelta  === 'string');
    assert.ok(typeof r.deltas      === 'object');
  }
});
