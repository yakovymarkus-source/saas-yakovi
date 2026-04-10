'use strict';

/**
 * marketing-memory.js — Marketing Memory Object Builder
 *
 * Aggregates all marketing data sources into a single normalized object.
 * Used by the creative engine as its sole source of context.
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
 */

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
  userIntelligence = [],
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
  // Only returns value if confidence meets a minimum threshold (0.5).
  // userIntelligence is inferred — low-confidence values are noise.
  const MIN_CONFIDENCE = 0.5;
  const getIntel = (category, key) => {
    const record = userIntelligence.find(
      (r) => r.category === category && r.key === key
    );
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

  const audience = {
    // problem_solved is the clearest signal for pain points
    pain_points: str(bp.problem_solved) || null,

    // desired_outcome is what the audience wants to achieve
    desires: str(bp.desired_outcome) || null,

    // No structured objections field exists in the current schema.
    // userIntelligence may carry a 'recurring_issue' insight that
    // sometimes reflects objections — use with low trust.
    objections: str(getIntel('insight', 'recurring_issue')) || null,

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

  // Top bottleneck: from analysisResults (diagnosed, not raw).
  // analysisResults.issues is sorted by severity — first item is highest priority.
  let topBottleneck = null;
  if (analysisResults?.issues && Array.isArray(analysisResults.issues) && analysisResults.issues.length > 0) {
    const topIssue = analysisResults.issues[0];
    topBottleneck = str(topIssue?.message) || str(topIssue?.type) || null;
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
    str(analysisResults?.verdict)              ||
    str(strategyMemory?.dominant_verdict)      ||
    str(getIntel('insight', 'recurring_issue')) ||
    null;

  const current = {
    funnel_stage: funnelStage,
    active_goal:  activeGoal,
    main_issue:   mainIssue,
  };

  // ── Assemble and return ────────────────────────────────────────────────────

  return {
    business,
    audience,
    positioning,
    performance,
    learnings,
    current,
  };
}

module.exports = { buildMarketingMemory };
