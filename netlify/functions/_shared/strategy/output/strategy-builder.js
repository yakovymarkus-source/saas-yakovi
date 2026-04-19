'use strict';
/**
 * strategy/output/strategy-builder.js
 * Assembles the final Output Contract from all engine results.
 * Output Contract (20.):
 * { product, positioning, strategy, test_plan, metrics, risks, fallback_options, confidence }
 */

function buildStrategyReport({
  jobId, userId, researchReportId, niche,
  product, positioning, revenueSystem, testPlan, metrics,
  risks, validation, decision, coherence, scalability, realityCheck,
  aiCallsMade, generationMs,
}) {
  const confidence = decision?.confidence || 0;

  // ── Product Block ──────────────────────────────────────────────────────────
  const productBlock = {
    selectedPain:     product.selectedPain,
    backupPains:      product.backupPains,
    outcome:          product.outcome,
    productType:      product.productType,
    productName:      product.productNameSuggestion || null,
    productStructure: product.productStructure || [],
    timeToResult:     product.timeToResult || null,
    complexity:       product.complexity   || null,
    viabilityScore:   product.viabilityScore,
    viabilityReasoning: product.viabilityReasoning || null,
  };

  // ── Positioning Block ─────────────────────────────────────────────────────
  const positioningBlock = {
    selectedPositioning: positioning.selectedPositioning,
    angleType:           positioning.angleType || null,
    whyUs:               positioning.whyUs     || positioning.whySelected || null,
    gapUsed:             positioning.gapUsed   || null,
    positionScore:       positioning.positionScore || 0,
    options:             positioning.positioningOptions || [],
  };

  // ── Strategy Block ─────────────────────────────────────────────────────────
  const strategyBlock = {
    targetCustomer:  revenueSystem.targetCustomer,
    coreMessage:     revenueSystem.coreMessage,
    angles:          revenueSystem.angles || [],
    method:          revenueSystem.method,
    tone:            revenueSystem.tone,
    platforms:       revenueSystem.platforms,
    assets:          revenueSystem.assets,
    funnel:          revenueSystem.funnel,
    coherence:       coherence,
    scalability:     scalability,
  };

  // ── Fallback Options ──────────────────────────────────────────────────────
  const fallbackOptions = [
    ...(product.backupPains.map(p => ({ action: 'switch_pain', value: p, trigger: 'low_conversion' }))),
    { action: 'switch_method', value: revenueSystem.method?.secondary?.method, trigger: 'low_ctr' },
    { action: 'switch_platform', value: revenueSystem.platforms?.secondary?.[0], trigger: 'high_cpc' },
  ].filter(f => f.value);

  return {
    // Identity
    job_id:              jobId,
    user_id:             userId,
    research_report_id:  researchReportId,
    niche,
    // Output Contract
    product:             productBlock,
    positioning:         positioningBlock,
    strategy:            strategyBlock,
    test_plan:           testPlan || {},
    metrics:             metrics  || {},
    risks:               risks    || [],
    fallback_options:    fallbackOptions,
    // Validation
    validation:          { status: validation?.status, passed: validation?.passed, total: validation?.total },
    reality_check:       realityCheck,
    // Meta
    confidence,
    ai_calls_made:       aiCallsMade,
    generation_ms:       generationMs,
    go_signal:           realityCheck?.go_signal || (confidence >= 70 ? 'ירוק' : confidence >= 45 ? 'צהוב' : 'אדום'),
  };
}

module.exports = { buildStrategyReport };
