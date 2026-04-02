'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pkg = require('..');

test('root package import works and exposes executable public API', () => {
  assert.equal(typeof pkg.buildInsights, 'function');
  assert.equal(typeof pkg.attachInsightsToAnalysis, 'function');
  assert.equal(typeof pkg.CONTRACT_VERSION, 'string');

  const result = pkg.buildInsights([
    { issue_code: 'low_ctr', severity: 'high', confidence: 0.93, priority_rank: 1 },
  ], {
    user_level: 'beginner',
    display_mode: 'simple',
    business_type: 'generic',
  });

  assert.equal(result.primary_insight.issue_code, 'low_ctr');
  assert.equal(result.meta.total_processed, 1);
  assert.equal(result.meta.contract_version, pkg.CONTRACT_VERSION);
});
