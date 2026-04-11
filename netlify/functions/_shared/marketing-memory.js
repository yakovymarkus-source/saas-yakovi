'use strict';

/**
 * marketing-memory.js — Marketing Memory Object Builder
 *
 * Aggregates all marketing data sources into a single normalized object.
 * Used by the creative engine and HTML composer as the sole source of context.
 *
 * Priority order (highest → lowest reliability):
 *   1. businessProfile  — direct user input, strongest signal
 *   2. apiCache         — real platform performance data
 *   3. analysisResults  — diagnosed problems (derived from apiCache)
 *   4. strategyMemory   — longitudinal trends (derived from analysisResults history)
 *   5. userIntelligence — inferred behavioral signals
 *   6. abTests          — empirical creative proof, but only when concluded
 *
 * RULES:
 *   - Never hallucinate. Missing data → null.
 *   - Higher-priority sources override lower-priority on the same field.
 *   - abTests only contribute if status === 'concluded' AND winner is set.
 *   - Inferred/derived fields are clearly marked with comments.
 *   - Categorical mappings (e.g. category → style) trace back to a real DB field.
 */

// ── Static mappings — module-level constants ──────────────────────────────────
// These map known categorical field values to design/layout descriptors.
// They are deterministic: same input always produces same output.
// NOT hallucination — each entry requires a real bp.category or bp.pricing_model value.

// bp.category → visual style direction
const CATEGORY_STYLE_MAP = Object.freeze({
  online_education: 'clean-professional',
  ecommerce:        'product-focused',
  services:         'trust-led',
  coaching:         'personal-brand',
  saas:             'minimal-tech',
  health:           'clean-clinical',
  finance:          'institutional-trust',
  real_estate:      'premium-visual',
  food:             'warm-sensory',
  beauty:           'aesthetic-premium',
});

// bp.pricing_model → visual energy / pacing style
const PRICING_ENERGY_MAP = Object.freeze({
  premium:      'elevated-restrained',
  subscription: 'modern-approachable',
  one_time:     'direct-conversion',
  freemium:     'light-accessible',
  custom:       'professional-bespoke',
});

// bp.primary_goal → CTA behavioral intent
const GOAL_CTA_MAP = Object.freeze({
  lead_generation: { intent: 'capture-contact', urgency: 'moderate', style: 'benefit-led'     },
  direct_sale:     { intent: 'purchase',        urgency: 'high',     style: 'price-anchored'  },
  awareness:       { intent: 'learn-more',      urgency: 'low',      style: 'curiosity-led'   },
  consultation:    { intent: 'book-call',       urgency: 'moderate', style: 'low-commitment'  },
  download:        { intent: 'get-resource',    urgency: 'low',      style: 'value-led'       },
  registration:    { intent: 'sign-up',         urgency: 'moderate', style: 'benefit-led'     },
});

// bp.category → inferred page length preference
// 'long': high-consideration categories (education, high-ticket services)
// 'short': low-friction categories (simple offer, warm traffic)
const PAGE_LENGTH_MAP = Object.freeze({
  online_education: 'long',
  coaching:         'long',
  finance:          'long',
  saas:             'long',
  services:         'long',
  health:           'long',
  real_estate:      'long',
  ecommerce:        'short',
  food:             'short',
  beauty:           'short',
});

// ab_test variable names that indicate a visual/creative test
// Used to filter which failed tests contribute to forbidden_styles
const VISUAL_VARIABLE_PATTERN = /visual|style|image|creative|color|layout|design|hero|banner|ad_style/i;

/**
 * buildMarketingMemory(sources)
 *
 * @param {object} sources
 * @param {object|null} sources.businessProfile  — profiles row
 * @param {object|null} sources.apiCache         — merged provider metrics (from analyze-service)
 * @param {object|null} sources.analysisResults  — latest analysis_results row
 * @param {object|null} sources.strategyMemory   — strategy_memory row
 * @param {object[]}    sources.userIntelligence — user_intelligence rows (all categories)
 * @param {object[]}    sources.abTests          — ab_tests rows (all statuses)
 *
 * @returns {MarketingMemory}
 */
function buildMarketingMemory({
  businessProfile  = null,
  apiCache         = null,
  analysisResults  = null,
  strategyMemory   = null,
  userIntelligence = null,
  abTests          = [],
} = {}) {

  // ── Helper: safe access ────────────────────────────────────────────────────

  // Return value only if it's a non-empty string, otherwise null
  const str = (v) => (typeof v === 'string' && v.trim().length > 0) ? v.trim() : null;

  // Return value only if it's a finite number, otherwise null
  const num = (v) => (typeof v === 'number' && isFinite(v)) ? v : null;

  // Return array only if non-empty, otherwise null
  const arr = (v) => (Array.isArray(v) && v.length > 0) ? v : null;

  // ── Helper: user_intelligence lookup ──────────────────────────────────────

  // Find a single intelligence record by category + key.
  // Expects the nested map shape from loadUserMemory():
  //   { preference: { focus_area: { value, confidence } }, insight: { ... }, ... }
  // Only returns value if confidence meets a minimum threshold (0.5).
  // userIntelligence is inferred — low-confidence values are noise.
  const MIN_CONFIDENCE = 0.5;
  const getIntel = (category, key) => {
    const record = userIntelligence?.[category]?.[key];
    if (!record) return null;
    if (typeof record.confidence === 'number' && record.confidence < MIN_CONFIDENCE) return null;
    return record.value ?? null;
  };

  // ── Helper: ab_tests — concluded only ─────────────────────────────────────

  // Split concluded tests into winners and losers.
  // Tests that are running/paused/invalidated carry no proven signal.
  const concludedTests = abTests.filter(
    (t) => t.status === 'concluded' && t.winner != null
  );

  const winningTests = concludedTests.filter((t) => t.winner === 'variant');
  const losingTests  = concludedTests.filter((t) => t.winner === 'control');

  // ── 1. BUSINESS ───────────────────────────────────────────────────────────
  // Source: businessProfile (strongest — direct user input)
  // All fields null if profile missing

  const bp = businessProfile || {};

  const business = {
    offer:     str(bp.offer)              || null,
    price:     str(bp.price_amount)       || null,
    audience:  str(bp.target_audience)    || null,
    mechanism: str(bp.unique_mechanism)   || null,
    promise:   str(bp.main_promise)       || null,
    // tone: prefer explicit tone_keywords, fall back to brand_tone field
    tone:      str(bp.tone_keywords)      || str(bp.brand_tone) || null,
  };

  // ── 2. AUDIENCE ───────────────────────────────────────────────────────────
  // Primary source: businessProfile fields
  // Supplemented by: userIntelligence (lower priority, inferred)
  //
  // These fields are not directly stored in a single column — they are
  // reconstructed from the most semantically relevant profile fields.

  // recurring_issue is stored as { key: "low_ctr", count: 3, last_seen: "..." }
  // Extract the key string — str() rejects objects, so we unwrap first.
  const riRaw = getIntel('insight', 'recurring_issue');
  const riStr = (riRaw && typeof riRaw === 'object') ? str(riRaw.key) : str(riRaw);

  const audience = {
    // problem_solved is the clearest signal for pain points
    pain_points: str(bp.problem_solved) || null,

    // desired_outcome is what the audience wants to achieve
    desires: str(bp.desired_outcome) || null,

    // No structured objections field exists in the current schema.
    // userIntelligence may carry a 'recurring_issue' insight that
    // sometimes reflects objections — use with low trust.
    objections: riStr || null,

    // Language patterns: tone_keywords is the closest proxy.
    // Falls back to inferred focus_area from intelligence.
    language_patterns:
      str(bp.tone_keywords) ||
      str(getIntel('preference', 'focus_area')) ||
      null,
  };

  // ── 3. POSITIONING ────────────────────────────────────────────────────────
  // Source: businessProfile (unique_mechanism, main_promise)
  // Supplemented by: concluded ab_tests (empirical differentiators)
  //
  // winning_angles: what has actually worked, from concluded tests
  // forbidden_claims: not tracked anywhere yet — always null until schema adds it

  const winningAngles = winningTests.length > 0
    ? winningTests.map((t) => {
        // Build a human-readable summary of what won
        const summary = str(t.result_summary);
        const label   = str(t.variable_name);
        const value   = str(t.variant_value);
        if (summary) return summary;
        if (label && value) return `${label}: "${value}"`;
        return null;
      }).filter(Boolean)
    : null;

  const positioning = {
    // unique_mechanism is the product's core differentiator
    differentiators: str(bp.unique_mechanism) || null,

    // Empirical winning angles from concluded A/B tests (highest-quality signal)
    // null if no concluded tests exist
    winning_angles: arr(winningAngles),

    // No forbidden_claims field in current schema
    forbidden_claims: null,
  };

  // ── 4. PERFORMANCE ────────────────────────────────────────────────────────
  // Primary source: apiCache (real platform numbers)
  // Supplemented by: analysisResults (top bottleneck — diagnosed problem)
  //                  strategyMemory (trend — longitudinal)
  //
  // apiCache structure from analyze-service: { ctr, roas, cpc, spend, conversions, ... }
  // We compute CPL (cost per lead) from spend/conversions if not directly stored.

  const cache = apiCache || {};

  // CTR: prefer direct value, guard against 0 being falsy
  const rawCtr  = num(cache.ctr);
  const rawRoas = num(cache.roas);

  // CPL: cost per lead. If not stored directly, derive from spend / conversions.
  let rawCpl = num(cache.cpl) ?? num(cache.cost_per_lead) ?? null;
  if (rawCpl === null && num(cache.spend) !== null && num(cache.conversions) > 0) {
    rawCpl = cache.spend / cache.conversions;
  }

  // Top bottleneck: from analysisResults.bottlenecks (array of stage strings: 'ctr','conversion',...)
  // persistAnalysis() stores the bottlenecks array directly on the analysis_results row.
  let topBottleneck = null;
  if (Array.isArray(analysisResults?.bottlenecks) && analysisResults.bottlenecks.length > 0) {
    topBottleneck = str(analysisResults.bottlenecks[0]) || null;
  }
  // Fallback: strategyMemory.persistent_bottlenecks[0] (recurring across sessions)
  if (!topBottleneck && strategyMemory?.persistent_bottlenecks?.length > 0) {
    topBottleneck = str(strategyMemory.persistent_bottlenecks[0]) || null;
  }

  // Trend: from strategyMemory (longitudinal — needs ≥2 analyses to be meaningful)
  // Returns null if insufficient_data — do not default to a fake trend
  const trend = str(strategyMemory?.score_trend) === 'insufficient_data'
    ? null
    : str(strategyMemory?.score_trend) || null;

  const performance = {
    ctr:            rawCtr,
    roas:           rawRoas,
    cpl:            rawCpl !== null ? Math.round(rawCpl * 100) / 100 : null, // round to 2 dp
    top_bottleneck: topBottleneck,
    trend:          trend,
  };

  // ── 5. LEARNINGS ─────────────────────────────────────────────────────────
  // Source: abTests (concluded only — empirical proof)
  // Supplemented by: strategyMemory.persistent_bottlenecks (what keeps failing)
  //
  // winning_hooks: variants that beat control
  // failed_hooks:  controls that beat variant (i.e. variant failed)
  // ab_results:    full summary of all concluded tests for reference

  const winningHooks = winningTests.length > 0
    ? winningTests.map((t) => ({
        variable:  str(t.variable_name),
        winner:    str(t.variant_value),
        summary:   str(t.result_summary),
      })).filter((h) => h.variable || h.winner)
    : null;

  const failedHooks = losingTests.length > 0
    ? losingTests.map((t) => ({
        variable: str(t.variable_name),
        failed:   str(t.variant_value),
        summary:  str(t.result_summary),
      })).filter((h) => h.variable || h.failed)
    : null;

  const abResults = concludedTests.length > 0
    ? concludedTests.map((t) => ({
        hypothesis: str(t.hypothesis),
        variable:   str(t.variable_name),
        winner:     str(t.winner),
        summary:    str(t.result_summary),
      }))
    : null;

  const learnings = {
    winning_hooks: arr(winningHooks),
    failed_hooks:  arr(failedHooks),
    ab_results:    arr(abResults),
  };

  // ── 6. CURRENT STATE ──────────────────────────────────────────────────────
  // Source: userIntelligence (inferred from behavior — lower trust)
  //         analysisResults.verdict (diagnosed current health)
  //         strategyMemory.dominant_verdict (longitudinal health signal)
  //
  // funnel_stage: where the user is in their campaign lifecycle
  // active_goal:  what they are trying to achieve right now
  // main_issue:   the single most important thing blocking progress

  // funnel_stage: prefer analysed insight, fall back to inferred
  const funnelStage =
    str(getIntel('insight', 'campaign_stage')) ||
    str(getIntel('goal', 'campaign_goal'))     ||
    null;

  // active_goal: from goal intelligence
  const activeGoal =
    str(getIntel('goal', 'campaign_goal'))    ||
    str(getIntel('preference', 'focus_area')) ||
    str(bp.primary_goal)                      || // businessProfile has this field
    null;

  // main_issue: the single most actionable problem right now
  // analysisResults.verdict is a live diagnosis — highest trust for current state
  const mainIssue =
    topBottleneck ||
    str(strategyMemory?.dominant_verdict)      ||
    riStr                                      || // riStr already extracted above
    null;

  const current = {
    funnel_stage: funnelStage,
    active_goal:  activeGoal,
    main_issue:   mainIssue,
  };

  // ── 7. VISUAL STYLE DNA ───────────────────────────────────────────────────
  // Source: businessProfile (category, pricing_model, tone_keywords/brand_tone)
  // category_style and pricing_energy are INFERRED from categorical mappings —
  // deterministic derivations, not hallucinations.

  const categoryStyle = bp.category ? (CATEGORY_STYLE_MAP[bp.category] || null) : null;
  const pricingStyle  = bp.pricing_model ? (PRICING_ENERGY_MAP[bp.pricing_model] || null) : null;
  const toneRaw       = str(bp.tone_keywords) || str(bp.brand_tone) || null;

  const visual_style_dna = {
    tone_keywords:     toneRaw,                        // direct from BP
    category_style:    categoryStyle,                  // inferred from bp.category
    pricing_energy:    pricingStyle,                   // inferred from bp.pricing_model
    business_category: str(bp.category)      || null,  // direct from BP
    pricing_model:     str(bp.pricing_model) || null,  // direct from BP
  };

  // ── 8. FORBIDDEN STYLES ──────────────────────────────────────────────────
  // Source: concluded ab_tests where control beat variant AND the test was visual.
  // Only visual-type tests contribute — text/copy tests are not visual restrictions.

  const forbiddenFromTests = losingTests
    .filter((t) => VISUAL_VARIABLE_PATTERN.test(str(t.variable_name) || ''))
    .map((t) => ({
      variable: str(t.variable_name),
      pattern:  str(t.variant_value),
      reason:   str(t.result_summary) || 'failed_in_test',
    }))
    .filter((f) => f.variable || f.pattern);

  const forbidden_styles = arr(forbiddenFromTests);

  // ── 9. APPROVED PATTERNS ─────────────────────────────────────────────────
  // Source: concluded ab_tests where variant beat control.
  // Includes both visual tests AND copy/hook tests — both signal what resonates.

  const approvedFromTests = winningTests
    .filter((t) =>
      VISUAL_VARIABLE_PATTERN.test(str(t.variable_name) || '') ||
      /hook|headline|copy/i.test(str(t.variable_name) || '')
    )
    .map((t) => ({
      variable: str(t.variable_name),
      pattern:  str(t.variant_value),
      summary:  str(t.result_summary),
    }))
    .filter((p) => p.variable || p.pattern);

  const approved_patterns = arr(approvedFromTests);

  // ── 10. REJECTED PATTERNS ────────────────────────────────────────────────
  // Source: all concluded tests where control won — any variable type.
  // Broader than forbidden_styles: covers copy, hooks, and structure too.

  const rejectedFromTests = losingTests
    .map((t) => ({
      variable: str(t.variable_name),
      pattern:  str(t.variant_value),
      reason:   str(t.result_summary) || 'outperformed_by_control',
    }))
    .filter((r) => r.variable || r.pattern);

  const rejected_patterns = arr(rejectedFromTests);

  // ── 11. CTA PREFERENCES ──────────────────────────────────────────────────
  // Source: businessProfile.primary_goal (via GOAL_CTA_MAP) + concluded CTA tests
  // proven_cta_text: variant values from tests where the variant won a CTA test

  const goalMeta  = bp.primary_goal ? (GOAL_CTA_MAP[bp.primary_goal] || null) : null;
  const ctaTests  = concludedTests.filter(
    (t) => /cta|button|call.?to.?action|submit/i.test(str(t.variable_name) || '')
  );
  const provenCta = arr(
    ctaTests
      .filter((t) => t.winner === 'variant')
      .map((t) => str(t.variant_value))
      .filter(Boolean)
  );

  const cta_preferences = {
    primary_goal:    str(bp.primary_goal) || null,
    intent:          goalMeta?.intent     || null,
    urgency_level:   goalMeta?.urgency    || null,
    style:           goalMeta?.style      || null,
    proven_cta_text: provenCta,
  };

  // ── 12. LAYOUT PREFERENCES ───────────────────────────────────────────────
  // Source: businessProfile (primary_goal → form_above_fold, category → page_length)
  // preferred_template is derived from page_length — deterministic, not AI guess.
  // milestone_stage from userIntelligence: stored as { current, total } object.

  const formAboveFold      = bp.primary_goal != null
    ? (bp.primary_goal === 'lead_generation')
    : null;
  const pageLengthInferred = bp.category ? (PAGE_LENGTH_MAP[bp.category] || null) : null;
  const templatePreference = pageLengthInferred === 'short'
    ? 'lp-short-offer-rtl'
    : pageLengthInferred === 'long'
      ? 'lp-conversion-rtl'
      : null;

  const milestoneRaw = getIntel('pattern', 'milestone_progress');

  const layout_preferences = {
    form_above_fold:       formAboveFold,
    preferred_page_length: pageLengthInferred,
    preferred_template:    templatePreference,
    primary_goal:          str(bp.primary_goal) || null,
    // milestone_progress is stored as { current, total } — extract current stage only
    milestone_stage:       (milestoneRaw && typeof milestoneRaw === 'object')
      ? (str(milestoneRaw.current) || null)
      : null,
  };

  // ── Assemble and return ────────────────────────────────────────────────────

  return {
    business,
    audience,
    positioning,
    performance,
    learnings,
    current,
    visual_style_dna,
    forbidden_styles,
    approved_patterns,
    rejected_patterns,
    cta_preferences,
    layout_preferences,
  };
}

module.exports = { buildMarketingMemory };
