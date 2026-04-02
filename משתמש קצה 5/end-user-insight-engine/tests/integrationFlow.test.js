'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildInsights, attachInsightsToAnalysis, CONTRACT_VERSION } = require('..');
const explanationEngine = require('../src/insights/explanationEngine');

test('real integration flow preserves full bundle deterministically with zero data loss', () => {
  const input = [
    { issue_code: 'high_cpa', severity: 'critical', confidence: 0.91, priority_rank: 1, metrics: { cpa: 180 } },
    { issue_code: 'low_ctr', severity: 'high', confidence: 0.84, priority_rank: 2, metrics: { ctr: 0.41 } },
    { issue_code: 'landing_page_issue', severity: 'medium', confidence: 0.72, priority_rank: 3 },
  ];
  const context = {
    user_level: 'beginner',
    display_mode: 'simple',
    business_type: 'lead_generation',
  };

  const built = buildInsights(input, context);
  const attached = attachInsightsToAnalysis({ analysis_id: 'a1', issues: input }, context);
  const bundle = attached.translated_insights;

  assert.deepEqual(bundle, built);
  assert.equal(bundle.primary_insight.id, bundle.primary_insights[0].id);
  assert.equal(bundle.meta.total_processed, bundle.all_insights.length);
  assert.equal(bundle.meta.total_skipped, bundle.skipped_insights.length);
  assert.deepEqual(bundle.low_priority_insights, bundle.lower_priority_insights);
  assert.equal(bundle.meta.contract_version, CONTRACT_VERSION);
});

test('integration flow preserves skipped insights and meta without data loss', () => {
  const original = explanationEngine.buildExplanation;
  explanationEngine.buildExplanation = (issue, context) => {
    if (issue.issue_code === 'bad_issue') {
      return {
        id: 'broken',
        issue_code: 'bad_issue',
        title: '',
        explanation: '',
        action: '',
        severity: 'medium',
        professional_label: '',
        simple_label: '',
        simple_summary: '',
        business_impact: '',
        likely_causes: [],
        first_action: '',
        learn_more: { term: '', definition: '' },
        confidence: 0.5,
        priority: 2,
        user_level: 'beginner',
        display_mode: 'simple',
        meta: {},
      };
    }

    return original(issue, context);
  };

  try {
    const input = [
      { issue_code: 'low_ctr', severity: 'high', confidence: 0.91, priority_rank: 1 },
      { issue_code: 'bad_issue', severity: 'medium', confidence: 0.5, priority_rank: 2 },
      { issue_code: 'high_cpa', severity: 'medium', confidence: 0.71, priority_rank: 3 },
    ];
    const context = {
      user_level: 'beginner',
      display_mode: 'simple',
      business_type: 'services',
    };

    const attached = attachInsightsToAnalysis({ analysis_id: 'a2', findings: input }, context);
    const bundle = attached.translated_insights;

    assert.equal(bundle.all_insights.length, 2);
    assert.equal(bundle.skipped_insights.length, 1);
    assert.equal(bundle.skipped_insights[0].issue_code, 'bad_issue');
    assert.equal(bundle.meta.total_processed, 2);
    assert.equal(bundle.meta.total_skipped, 1);
    assert.equal(bundle.meta.business_type, 'services');
    assert.equal(bundle.primary_insight.id, bundle.primary_insights[0].id);
    assert.equal(bundle.meta.contract_version, CONTRACT_VERSION);
  } finally {
    explanationEngine.buildExplanation = original;
  }
});
