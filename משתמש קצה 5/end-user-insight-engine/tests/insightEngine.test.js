'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const explanationEngine = require('../src/insights/explanationEngine');
const { buildInsights } = require('../src/insights/insightEngine');
const { buildExplanation } = explanationEngine;
const { attachInsightsToAnalysis } = require('../src/integrations/analysisInsightAdapter');
const { CONTRACT_VERSION } = require('../src/contract');

test('dictionary hit returns known low_ctr copy', () => {
  const result = buildExplanation({ issue_code: 'low_ctr', severity: 'high', confidence: 0.9, priority_rank: 1 }, { user_level: 'beginner', display_mode: 'simple', business_type: 'lead_generation' });
  assert.equal(result.simple_label, 'מעט מדי אנשים לוחצים על המודעה');
  assert.match(result.business_impact, /טופס|שיחה/);
  assert.equal(result.meta.fallback_mode, 'dictionary');
});

test('template fallback handles unknown patterned issue', () => {
  const result = buildExplanation({ issue_code: 'high_cost_per_result', severity: 'medium', confidence: 0.7, priority_rank: 2 }, { user_level: 'beginner', display_mode: 'simple', business_type: 'generic' });
  assert.equal(result.meta.fallback_mode, 'template');
  assert.match(result.simple_label, /עלות גבוהה מדי/);
  assert.match(result.first_action, /אל תגדיל תקציב/);
});

test('safe fallback handles unknown issue without crashing', () => {
  const result = buildExplanation({ issue_code: 'mystery_breakdown_signal', severity: 'low', confidence: 0.4, priority_rank: 9 }, { user_level: 'beginner', display_mode: 'simple', business_type: 'generic' });
  assert.equal(result.meta.fallback_mode, 'safe_fallback');
  assert.match(result.simple_summary, /המערכת זיהתה סימן לבעיה/);
  assert.equal(result.learn_more.term, 'mystery_breakdown_signal');
});

test('beginner mode stays plain', () => {
  const result = buildExplanation({ issue_code: 'tracking_uncertainty', severity: 'medium', confidence: 0.8, priority_rank: 1 }, { user_level: 'beginner', display_mode: 'simple', business_type: 'services' });
  assert.doesNotMatch(result.simple_summary, /גרסה המקצועית/);
  assert.match(result.simple_label, /הנתונים לא מספיק אמינים/);
});

test('advanced professional mode keeps professional framing', () => {
  const result = buildExplanation({ issue_code: 'low_conversion_rate', severity: 'high', confidence: 0.95, priority_rank: 1 }, { user_level: 'advanced', display_mode: 'professional', business_type: 'ecommerce' });
  assert.match(result.professional_label, /HIGH/);
  assert.equal(result.display_mode, 'professional');
  assert.match(result.learn_more.definition, /האחוז מתוך המבקרים/);
});

test('professional mode adds professional term while preserving plain structure', () => {
  const result = buildExplanation({ issue_code: 'high_cpa', severity: 'high', confidence: 0.88, priority_rank: 1 }, { user_level: 'beginner', display_mode: 'professional', business_type: 'services' });
  assert.equal(result.learn_more.term, 'CPA');
  assert.match(result.simple_summary, /גרסה המקצועית/);
});

test('prioritization picks highest severity first', () => {
  const output = buildInsights([
    { issue_code: 'low_ctr', severity: 'medium', confidence: 0.9, priority_rank: 2 },
    { issue_code: 'high_cpa', severity: 'critical', confidence: 0.7, priority_rank: 3 },
    { issue_code: 'landing_page_issue', severity: 'high', confidence: 0.95, priority_rank: 1 },
  ], { user_level: 'beginner', display_mode: 'simple', business_type: 'lead_generation' });

  assert.equal(output.primary_insight.issue_code, 'high_cpa');
  assert.equal(output.primary_insights[0].issue_code, 'high_cpa');
  assert.equal(output.secondary_insights[0].issue_code, 'landing_page_issue');
});

test('integration adapter attaches translated insights to analysis output', () => {
  const analysis = {
    account_id: 'acc_1',
    issues: [
      { issue_code: 'low_ctr', severity: 'high', confidence: 0.9, priority_rank: 1, metrics: { ctr: 0.42 } },
      { issue_code: 'low_conversion_rate', severity: 'medium', confidence: 0.85, priority_rank: 2, metrics: { conversion_rate: 1.1 } },
    ],
  };

  const result = attachInsightsToAnalysis(analysis, { user_level: 'beginner', display_mode: 'simple', business_type: 'lead_generation' });
  assert.ok(result.translated_insights);
  assert.equal(result.translated_insights.primary_insights[0].issue_code, 'low_ctr');
  assert.match(result.translated_insights.secondary_insights[0].simple_label, /אנשים נכנסים אבל לא משאירים פרטים/);
  assert.equal(Array.isArray(result.translated_insights.all_insights), true);
  assert.equal(Array.isArray(result.translated_insights.skipped_insights), true);
  assert.equal(typeof result.translated_insights.meta, 'object');
  assert.equal(result.translated_insights.meta.contract_version, CONTRACT_VERSION);
});

test('partial failure skips only broken insight', () => {
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
      };
    }
    return original(issue, context);
  };

  try {
    const result = buildInsights([
      { issue_code: 'low_ctr', severity: 'high', confidence: 0.9, priority_rank: 1 },
      { issue_code: 'bad_issue', severity: 'medium', confidence: 0.5, priority_rank: 2 },
      { issue_code: 'high_cpa', severity: 'medium', confidence: 0.6, priority_rank: 3 },
    ], { user_level: 'beginner', display_mode: 'simple', business_type: 'generic' });

    assert.equal(result.all_insights.length, 2);
    assert.equal(result.skipped_insights.length, 1);
    assert.equal(result.skipped_insights[0].issue_code, 'bad_issue');
    assert.deepEqual(result.all_insights.map((item) => item.issue_code), ['low_ctr', 'high_cpa']);
  } finally {
    explanationEngine.buildExplanation = original;
  }
});

test('malformed input stays stable and returns empty output when needed', () => {
  const cases = [null, undefined, {}, 'bad', 42, [null, undefined, {}, [], { nope: true }]];

  for (const input of cases) {
    const result = buildInsights(input, { user_level: 'beginner', display_mode: 'simple', business_type: 'generic' });
    assert.equal(Array.isArray(result.all_insights), true);
    assert.equal(Array.isArray(result.skipped_insights), true);
    assert.equal(result.primary_insight === null || typeof result.primary_insight === 'object', true);
  }

  const mixed = buildInsights([
    null,
    undefined,
    {},
    { issue_code: 'low_ctr', severity: 'high', confidence: 0.8, priority_rank: 1 },
    { nope: true },
  ], { user_level: 'beginner', display_mode: 'simple', business_type: 'generic' });

  assert.equal(mixed.all_insights.length, 1);
  assert.equal(mixed.all_insights[0].issue_code, 'low_ctr');
});

test('duplicate issues are removed deterministically', () => {
  const result = buildInsights([
    { issue_code: 'low_ctr', severity: 'high', confidence: 0.9, priority_rank: 1 },
    { issue_code: 'low_ctr', severity: 'high', confidence: 0.9, priority_rank: 1 },
    { issue_code: 'low_ctr', severity: 'high', confidence: 0.9, priority_rank: 1 },
    { issue_code: 'high_cpa', severity: 'medium', confidence: 0.7, priority_rank: 2 },
  ], { user_level: 'beginner', display_mode: 'simple', business_type: 'generic' });

  assert.equal(result.all_insights.length, 2);
  assert.deepEqual(result.all_insights.map((item) => item.issue_code), ['low_ctr', 'high_cpa']);
});

test('bulk input remains stable above 100 items', () => {
  const bulk = Array.from({ length: 150 }, (_, index) => ({
    issue_code: `high_cost_case_${index}`,
    severity: index % 2 === 0 ? 'high' : 'medium',
    confidence: 0.6,
    priority_rank: index + 1,
    metrics: { idx: index },
  }));

  const result = buildInsights(bulk, { user_level: 'beginner', display_mode: 'simple', business_type: 'generic' });

  assert.equal(result.all_insights.length, 150);
  assert.equal(result.skipped_insights.length, 0);
  assert.equal(result.primary_insight.issue_code, 'high_cost_case_0');
  assert.equal(result.lower_priority_insights.length, 147);
});

test('same input always returns identical output', () => {
  const input = [
    { issue_code: 'high_cpa', severity: 'high', confidence: 0.88, priority_rank: 2, metrics: { cpa: 12 } },
    { issue_code: 'low_ctr', severity: 'high', confidence: 0.91, priority_rank: 1, metrics: { ctr: 0.42 } },
    { issue_code: 'landing_page_issue', severity: 'medium', confidence: 0.77, priority_rank: 3 },
  ];
  const context = { user_level: 'advanced', display_mode: 'professional', business_type: 'services' };

  const first = buildInsights(input, context);
  const second = buildInsights(input, context);
  const third = buildInsights(input, context);

  assert.deepEqual(first, second);
  assert.deepEqual(second, third);
});

test('professional label is dynamic and deterministic', () => {
  const a = buildExplanation({ issue_code: 'low_ctr', severity: 'high', priority_rank: 1, metrics: { ctr: 0.4 } }, { business_type: 'services', user_level: 'advanced', display_mode: 'professional' });
  const b = buildExplanation({ issue_code: 'low_ctr', severity: 'critical', priority_rank: 1, metrics: { ctr: 0.4 } }, { business_type: 'services', user_level: 'advanced', display_mode: 'professional' });
  const c = buildExplanation({ issue_code: 'low_ctr', severity: 'high', priority_rank: 1, metrics: { ctr: 0.4 } }, { business_type: 'ecommerce', user_level: 'advanced', display_mode: 'professional' });

  assert.notEqual(a.professional_label, b.professional_label);
  assert.notEqual(a.professional_label, c.professional_label);
  assert.equal(a.professional_label, buildExplanation({ issue_code: 'low_ctr', severity: 'high', priority_rank: 1, metrics: { ctr: 0.4 } }, { business_type: 'services', user_level: 'advanced', display_mode: 'professional' }).professional_label);
});

test('strict output contract is always present on final insights', () => {
  const result = buildInsights([
    { issue_code: 'high_cpa', severity: 'high', confidence: 0.9, priority_rank: 1 },
  ], { user_level: 'beginner', display_mode: 'simple', business_type: 'generic' });

  const insight = result.primary_insight;
  assert.equal(typeof insight.id, 'string');
  assert.equal(typeof insight.title, 'string');
  assert.equal(typeof insight.explanation, 'string');
  assert.equal(typeof insight.priority, 'number');
  assert.equal(typeof insight.severity, 'string');
  assert.equal(typeof insight.action, 'string');
});


test('adapter returns full translated bundle contract', () => {
  const analysis = {
    account_id: 'acc_bundle',
    issues: [
      { issue_code: 'high_cpa', severity: 'critical', confidence: 0.91, priority_rank: 1 },
      { issue_code: 'low_ctr', severity: 'high', confidence: 0.87, priority_rank: 2 },
      { issue_code: 'landing_page_issue', severity: 'medium', confidence: 0.76, priority_rank: 3 },
      { issue_code: 'landing_page_issue', severity: 'medium', confidence: 0.76, priority_rank: 3 },
    ],
  };

  const result = attachInsightsToAnalysis(analysis, { user_level: 'beginner', display_mode: 'simple', business_type: 'services' });
  const bundle = result.translated_insights;

  assert.equal(Array.isArray(bundle.all_insights), true);
  assert.equal(Array.isArray(bundle.primary_insights), true);
  assert.equal(Array.isArray(bundle.secondary_insights), true);
  assert.equal(Array.isArray(bundle.low_priority_insights), true);
  assert.equal(Array.isArray(bundle.skipped_insights), true);
  assert.equal(typeof bundle.meta, 'object');
  assert.equal(bundle.primary_insights.length, 1);
  assert.equal(bundle.primary_insights[0].issue_code, 'high_cpa');
  assert.equal(bundle.secondary_insights.length, 2);
  assert.equal(bundle.low_priority_insights.length, 0);
  assert.equal(bundle.all_insights.length, 3);
  assert.equal(bundle.meta.total_input, 4);
  assert.equal(bundle.meta.total_processed, 3);
  assert.equal(bundle.meta.total_skipped, 0);
  assert.equal(bundle.meta.contract_version, CONTRACT_VERSION);
});

test('adapter preserves skipped insights and bundle meta', () => {
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
      };
    }
    return original(issue, context);
  };

  try {
    const result = attachInsightsToAnalysis({
      issues: [
        { issue_code: 'low_ctr', severity: 'high', confidence: 0.9, priority_rank: 1 },
        { issue_code: 'bad_issue', severity: 'medium', confidence: 0.5, priority_rank: 2 },
        { issue_code: 'high_cpa', severity: 'low', confidence: 0.5, priority_rank: 3 },
      ],
    }, { user_level: 'beginner', display_mode: 'simple', business_type: 'generic' });

    const bundle = result.translated_insights;
    assert.equal(bundle.all_insights.length, 2);
    assert.equal(bundle.skipped_insights.length, 1);
    assert.equal(bundle.skipped_insights[0].issue_code, 'bad_issue');
    assert.equal(bundle.meta.total_input, 3);
    assert.equal(bundle.meta.total_processed, 2);
    assert.equal(bundle.meta.total_skipped, 1);
  } finally {
    explanationEngine.buildExplanation = original;
  }
});



test('final bundle validator rejects missing or drifted contract version', () => {
  const valid = buildInsights([
    { issue_code: 'low_ctr', severity: 'high', confidence: 0.9, priority_rank: 1 },
  ], { user_level: 'beginner', display_mode: 'simple', business_type: 'generic' });

  const missingVersion = {
    ...valid,
    meta: {
      ...valid.meta,
    },
  };
  delete missingVersion.meta.contract_version;

  assert.throws(() => require('../src/insights/validator').validateFinalBundle(missingVersion), /contract_version/);

  const driftedVersion = {
    ...valid,
    meta: {
      ...valid.meta,
      contract_version: '999.999.999',
    },
  };

  assert.throws(() => require('../src/insights/validator').validateFinalBundle(driftedVersion), /contract version/);
});

test('final bundle validator enforces structure before returning', () => {
  const result = buildInsights([
    { issue_code: 'low_ctr', severity: 'high', confidence: 0.9, priority_rank: 1 },
  ], { user_level: 'beginner', display_mode: 'simple', business_type: 'generic' });

  assert.equal(Array.isArray(result.primary_insights), true);
  assert.equal(Array.isArray(result.secondary_insights), true);
  assert.equal(Array.isArray(result.low_priority_insights), true);
  assert.equal(Array.isArray(result.skipped_insights), true);
  assert.equal(typeof result.meta, 'object');
  assert.equal(result.meta.deterministic_ordering, true);
});
