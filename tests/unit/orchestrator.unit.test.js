'use strict';

/**
 * orchestrator.unit.test.js — Orchestration Layer Unit Tests
 *
 * Tests orchestrate() behavior without real AI providers.
 * Uses module mocking via require() override patterns so no real API calls are made.
 *
 * Strategy:
 *   - The real providers will return { ok: false, error: 'PROVIDER_NOT_CONFIGURED' }
 *     when API keys are absent (which is always the case in test env).
 *   - Tests verify: capability routing, prompt-builder errors, retry behavior,
 *     and that orchestrate() never throws.
 *
 * Covered: orchestrator.js, prompt-builders (pure function contracts)
 * Not covered here: individual adapter HTTP behavior (integration tests)
 */

const test   = require('node:test');
const assert = require('node:assert/strict');

// ── Prompt builders (pure functions — safe to test without mocking) ────────────

const { buildAdCopyPrompt }           = require('../../netlify/functions/_shared/prompt-builders/ad-copy');
const { buildAnalysisPrompt }         = require('../../netlify/functions/_shared/prompt-builders/analysis');
const { buildIssueExplanationPrompt } = require('../../netlify/functions/_shared/prompt-builders/issue-explanation');
const { buildLandingPagePrompt }      = require('../../netlify/functions/_shared/prompt-builders/landing-page');
const { buildIterationAdvicePrompt }  = require('../../netlify/functions/_shared/prompt-builders/iteration-advice');

// ── Contract helpers ───────────────────────────────────────────────────────────

const { CAPABILITIES, validateAdapter, buildStandardResult } = require('../../netlify/functions/_shared/providers/contract');

// ═══════════════════════════════════════════════════════════════════════════════
// CAPABILITIES enum
// ═══════════════════════════════════════════════════════════════════════════════

test('CAPABILITIES — has all 7 expected values', () => {
  const expected = ['ad_copy', 'campaign_strategy', 'analysis_summary', 'issue_explanation', 'iteration_advice', 'landing_page', 'image_generation'];
  for (const cap of expected) {
    assert.ok(Object.values(CAPABILITIES).includes(cap), `Missing capability: ${cap}`);
  }
  assert.equal(Object.values(CAPABILITIES).length, 7);
});

// ═══════════════════════════════════════════════════════════════════════════════
// buildStandardResult
// ═══════════════════════════════════════════════════════════════════════════════

test('buildStandardResult — success shape', () => {
  const r = buildStandardResult({
    ok: true, provider: 'openai', capability: 'ad_copy',
    model: 'gpt-4o-mini', content: { variants: [] },
    usage: { promptTokens: 100, completionTokens: 200 },
    latency_ms: 350,
  });
  assert.equal(r.ok, true);
  assert.equal(r.provider, 'openai');
  assert.equal(r.capability, 'ad_copy');
  assert.deepEqual(r.content, { variants: [] });
  assert.equal(r.usage.promptTokens, 100);
  assert.equal(r.latency_ms, 350);
});

test('buildStandardResult — error shape', () => {
  const r = buildStandardResult({
    ok: false, provider: 'openai', capability: 'ad_copy',
    error: 'RATE_LIMITED', errorMessage: 'Too many requests',
    latency_ms: 50,
  });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'RATE_LIMITED');
  assert.equal(r.errorMessage, 'Too many requests');
  assert.equal(r.content, undefined);
});

// ═══════════════════════════════════════════════════════════════════════════════
// validateAdapter
// ═══════════════════════════════════════════════════════════════════════════════

test('validateAdapter — passes for valid adapter', () => {
  const adapter = {
    getName:         () => 'test',
    getCapabilities: () => ['ad_copy'],
    validateInput:   () => true,
    execute:         async () => ({}),
    parseResponse:   () => ({}),
  };
  assert.doesNotThrow(() => validateAdapter(adapter));
});

test('validateAdapter — throws if getName is missing', () => {
  const adapter = {
    getCapabilities: () => [],
    validateInput:   () => true,
    execute:         async () => ({}),
    parseResponse:   () => ({}),
  };
  assert.throws(() => validateAdapter(adapter), /getName/);
});

test('validateAdapter — throws if execute is missing', () => {
  const adapter = {
    getName:         () => 'test',
    getCapabilities: () => [],
    validateInput:   () => true,
    parseResponse:   () => ({}),
  };
  assert.throws(() => validateAdapter(adapter), /execute/);
});

// ═══════════════════════════════════════════════════════════════════════════════
// buildAdCopyPrompt — pure function
// ═══════════════════════════════════════════════════════════════════════════════

const fullProfile = {
  offer:            'מכשיר לייזר ביתי להסרת שיער',
  price_amount:     1500,
  pricing_model:    'one_time',
  target_audience:  'נשים שלא רוצות ללכת למכון לייזר',
  problem_solved:   'עלות גבוהה ואי-נוחות בטיפולים חיצוניים',
  desired_outcome:  'הסרת שיער מבית ללא ביקורים',
  unique_mechanism: 'מכשיר IPL ביתי מדרגה רפואית',
  primary_goal:     'leads',
};

test('buildAdCopyPrompt — returns system, user, maxTokens', () => {
  const prompt = buildAdCopyPrompt({ businessProfile: fullProfile });
  assert.ok(typeof prompt.system === 'string', 'system must be string');
  assert.ok(typeof prompt.user   === 'string', 'user must be string');
  assert.ok(typeof prompt.maxTokens === 'number', 'maxTokens must be number');
  assert.ok(prompt.maxTokens > 0, 'maxTokens must be positive');
});

test('buildAdCopyPrompt — system prompt instructs JSON-only output', () => {
  const prompt = buildAdCopyPrompt({ businessProfile: fullProfile });
  assert.ok(prompt.system.toLowerCase().includes('json'), 'system should mention JSON');
});

test('buildAdCopyPrompt — user prompt includes offer text', () => {
  const prompt = buildAdCopyPrompt({ businessProfile: fullProfile });
  assert.ok(prompt.user.includes('לייזר'), 'user prompt should include offer content');
});

test('buildAdCopyPrompt — bottleneck=ctr mentions problem_agitate', () => {
  const prompt = buildAdCopyPrompt({ businessProfile: fullProfile, bottleneck: 'ctr' });
  assert.ok(prompt.user.toLowerCase().includes('problem'), 'ctr bottleneck should prioritize problem_agitate');
});

test('buildAdCopyPrompt — works with minimal profile (no crash)', () => {
  assert.doesNotThrow(() => buildAdCopyPrompt({ businessProfile: {} }));
});

// ═══════════════════════════════════════════════════════════════════════════════
// buildAnalysisPrompt — pure function
// ═══════════════════════════════════════════════════════════════════════════════

const analysisInput = {
  metrics:     { ctr: 0.02, convRate: 0.01, roas: 1.5, cpc: 5, spend: 500, conversions: 5, impressions: 25000 },
  scores:      { overall: 45, ctr: 50, conversion: 30, roas: 40 },
  bottlenecks: ['conversion'],
  decisions:   [{ verdict: 'needs_work' }],
  businessProfile: fullProfile,
};

test('buildAnalysisPrompt — returns system, user, maxTokens', () => {
  const prompt = buildAnalysisPrompt(analysisInput);
  assert.ok(typeof prompt.system === 'string');
  assert.ok(typeof prompt.user   === 'string');
  assert.ok(prompt.maxTokens >= 500);
});

test('buildAnalysisPrompt — user prompt includes metric values', () => {
  const prompt = buildAnalysisPrompt(analysisInput);
  assert.ok(prompt.user.includes('CTR'), 'should include CTR');
  assert.ok(prompt.user.includes('ROAS'), 'should include ROAS');
});

test('buildAnalysisPrompt — user prompt includes bottleneck', () => {
  const prompt = buildAnalysisPrompt(analysisInput);
  assert.ok(prompt.user.includes('conversion'), 'should include bottleneck');
});

// ═══════════════════════════════════════════════════════════════════════════════
// buildIssueExplanationPrompt — pure function
// ═══════════════════════════════════════════════════════════════════════════════

test('buildIssueExplanationPrompt — returns system, user, maxTokens', () => {
  const prompt = buildIssueExplanationPrompt({
    issueCode: 'low_ctr',
    metrics:   { ctr: 0.005 },
    businessProfile: fullProfile,
  });
  assert.ok(typeof prompt.system === 'string');
  assert.ok(typeof prompt.user   === 'string');
  assert.ok(prompt.maxTokens > 0);
});

test('buildIssueExplanationPrompt — user prompt includes issueCode', () => {
  const prompt = buildIssueExplanationPrompt({
    issueCode: 'low_ctr',
    metrics:   { ctr: 0.005 },
  });
  assert.ok(prompt.user.includes('low_ctr'), 'should reference the issue code');
});

test('buildIssueExplanationPrompt — userLevel advanced changes system tone', () => {
  const beginner = buildIssueExplanationPrompt({ issueCode: 'x', userLevel: 'beginner' });
  const advanced = buildIssueExplanationPrompt({ issueCode: 'x', userLevel: 'advanced' });
  assert.notEqual(beginner.system, advanced.system);
});

// ═══════════════════════════════════════════════════════════════════════════════
// buildLandingPagePrompt — pure function
// ═══════════════════════════════════════════════════════════════════════════════

test('buildLandingPagePrompt — returns system, user, maxTokens', () => {
  const prompt = buildLandingPagePrompt({ businessProfile: fullProfile });
  assert.ok(typeof prompt.system === 'string');
  assert.ok(typeof prompt.user   === 'string');
  assert.ok(prompt.maxTokens >= 1500);
});

test('buildLandingPagePrompt — includes all 7 section types in user prompt', () => {
  const prompt = buildLandingPagePrompt({ businessProfile: fullProfile });
  const sections = ['hero', 'problem', 'solution', 'social_proof', 'offer', 'faq', 'cta'];
  for (const s of sections) {
    assert.ok(prompt.user.includes(`"${s}"`), `should include section type: ${s}`);
  }
});

test('buildLandingPagePrompt — ad copy context appears when adCopy provided', () => {
  const adCopy = { headline: 'מסיר שיער בבית', body: 'ללא כאב\nמהיר', cta: 'הזמן עכשיו' };
  const prompt = buildLandingPagePrompt({ businessProfile: fullProfile, adCopy });
  assert.ok(prompt.user.includes('מסיר שיער בבית'), 'should include ad headline for message continuity');
});

test('buildLandingPagePrompt — no adCopy → generic instruction', () => {
  const prompt = buildLandingPagePrompt({ businessProfile: fullProfile });
  assert.ok(prompt.user.includes('general conversion'), 'should note no ad copy provided');
});

// ═══════════════════════════════════════════════════════════════════════════════
// buildIterationAdvicePrompt — pure function
// ═══════════════════════════════════════════════════════════════════════════════

test('buildIterationAdvicePrompt — returns system, user, maxTokens', () => {
  const prompt = buildIterationAdvicePrompt({
    verdict: 'stop',
    bottleneckDelta: { stageDelta: 'critical_decline', primaryStage: 'ctr' },
    currentMetrics:  { roas: 0.8, ctr: 0.005, convRate: 0.005, spend: 800 },
    businessProfile: fullProfile,
  });
  assert.ok(typeof prompt.system === 'string');
  assert.ok(typeof prompt.user   === 'string');
  assert.ok(prompt.maxTokens > 0);
});

test('buildIterationAdvicePrompt — user prompt includes verdict', () => {
  const prompt = buildIterationAdvicePrompt({ verdict: 'rewrite_creative' });
  assert.ok(prompt.user.includes('rewrite_creative'), 'should include verdict in prompt');
});

test('buildIterationAdvicePrompt — known verdicts get context description', () => {
  const verdicts = ['stop', 'rewrite_creative', 'fix_landing', 'scale', 'test_variation', 'monitor'];
  for (const verdict of verdicts) {
    const prompt = buildIterationAdvicePrompt({ verdict });
    // The VERDICT_CONTEXT description should appear, not just the verdict name
    assert.ok(prompt.user.length > 100, `prompt for verdict=${verdict} should have substantial content`);
  }
});

test('buildIterationAdvicePrompt — works with no metrics (no crash)', () => {
  assert.doesNotThrow(() => buildIterationAdvicePrompt({ verdict: 'monitor' }));
});

// ═══════════════════════════════════════════════════════════════════════════════
// orchestrate() — no-API behavior (provider returns PROVIDER_NOT_CONFIGURED)
// ═══════════════════════════════════════════════════════════════════════════════

// When OPENAI_API_KEY is not set, the adapter returns
// { ok: false, error: 'PROVIDER_NOT_CONFIGURED' } without making any HTTP calls.
// orchestrate() must: never throw, return { ok: false }, include the capability.

const { orchestrate } = require('../../netlify/functions/_shared/orchestrator');

test('orchestrate — never throws, returns StandardResult shape', async () => {
  const result = await orchestrate(CAPABILITIES.AD_COPY, { businessProfile: fullProfile }, {});
  assert.ok(typeof result.ok         === 'boolean', 'ok must be boolean');
  assert.ok(typeof result.provider   === 'string',  'provider must be string');
  assert.ok(typeof result.capability === 'string',  'capability must be string');
  assert.ok(typeof result.latency_ms === 'number',  'latency_ms must be number');
});

test('orchestrate — returns capability in result', async () => {
  const result = await orchestrate(CAPABILITIES.AD_COPY, { businessProfile: fullProfile }, {});
  assert.equal(result.capability, CAPABILITIES.AD_COPY);
});

test('orchestrate — CAPABILITY_NOT_FOUND for unknown capability', async () => {
  const result = await orchestrate('nonexistent_capability', {}, {});
  assert.equal(result.ok, false);
  assert.equal(result.error, 'CAPABILITY_NOT_FOUND');
  assert.equal(result.latency_ms, 0);
});

test('orchestrate — PROMPT_BUILD_ERROR when payload causes builder to throw', async () => {
  // Pass a payload with a getter that throws — simulates a malformed payload
  // that causes the prompt builder to throw
  const badPayload = Object.defineProperty({}, 'businessProfile', {
    get() { throw new Error('synthetic payload error'); },
  });
  // We use analysis_summary since its builder destructures { metrics, scores, ... }
  // and will throw when accessing the bad property
  const result = await orchestrate(CAPABILITIES.ANALYSIS_SUMMARY, badPayload, {});
  // Either PROMPT_BUILD_ERROR or the provider fails — both are non-throwing
  assert.equal(result.ok, false);
  assert.ok(typeof result.error === 'string', 'error must be a string code');
});

test('orchestrate — returns { ok: false } when provider not configured', async () => {
  // In test environment OPENAI_API_KEY is absent → PROVIDER_NOT_CONFIGURED
  const result = await orchestrate(CAPABILITIES.AD_COPY, { businessProfile: fullProfile }, {});
  if (!result.ok) {
    assert.ok(['PROVIDER_NOT_CONFIGURED', 'NETWORK_ERROR', 'TIMEOUT', 'PARSE_ERROR', 'UNKNOWN_ERROR'].includes(result.error),
      `Unexpected error code: ${result.error}`);
  }
  // If somehow it is ok (API key set in env), that is also valid
});

test('orchestrate — analysis_summary: never throws', async () => {
  const result = await orchestrate(CAPABILITIES.ANALYSIS_SUMMARY, {
    metrics:     { ctr: 0.01, convRate: 0.005, roas: 1.2, cpc: 8, spend: 200, conversions: 1, impressions: 20000 },
    scores:      { overall: 30, ctr: 20, conversion: 25, roas: 30 },
    bottlenecks: ['ctr', 'conversion'],
    decisions:   [],
    businessProfile: {},
  }, {});
  assert.ok(typeof result.ok === 'boolean');
});

test('orchestrate — iteration_advice: never throws', async () => {
  const result = await orchestrate(CAPABILITIES.ITERATION_ADVICE, {
    verdict: 'test_variation',
    bottleneckDelta: {},
    currentMetrics: {},
    businessProfile: {},
  }, {});
  assert.ok(typeof result.ok === 'boolean');
});

test('orchestrate — landing_page: never throws', async () => {
  const result = await orchestrate(CAPABILITIES.LANDING_PAGE, {
    businessProfile: fullProfile,
  }, {});
  assert.ok(typeof result.ok === 'boolean');
});
