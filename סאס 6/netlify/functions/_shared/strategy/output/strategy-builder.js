'use strict';
/**
 * strategy/output/strategy-builder.js
 * Assembles the final Output Contract from all engine results.
 * Output Contract (20-module protocol):
 * { product, positioning, strategy, test_plan, metrics, risks, fallback_options, confidence }
 */

function buildStrategyReport({
  jobId, userId, researchReportId, niche,
  product, positioning, revenueSystem, testPlan, metrics,
  risks, validation, decision, coherence, scalability, realityCheck, systemFit,
  aiCallsMade, generationMs,
}) {
  const confidence = decision?.confidence || 0;

  // ── Product Block ──────────────────────────────────────────────────────────
  const productBlock = {
    selectedPain:       product.selectedPain,
    backupPains:        product.backupPains,
    outcome:            product.outcome,
    productType:        product.productType,
    productName:        product.productNameSuggestion || null,
    productStructure:   product.productStructure || [],
    timeToResult:       product.timeToResult || null,
    complexity:         product.complexity   || null,
    viabilityScore:     product.viabilityScore,
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

  // ── Strategy Block ────────────────────────────────────────────────────────
  // Full Revenue System: method + tone + platforms + assets + funnel + angles + message
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
    system_fit:      systemFit || null,
  };

  // ── Fallback Options ──────────────────────────────────────────────────────
  const fallbackOptions = [
    ...(product.backupPains.map(p => ({ action: 'switch_pain', value: p, trigger: 'low_conversion' }))),
    { action: 'switch_method', value: revenueSystem.method?.secondary?.method, trigger: 'low_ctr' },
    { action: 'switch_platform', value: revenueSystem.platforms?.secondary?.[0], trigger: 'high_cpc' },
    { action: 'switch_tone', value: revenueSystem.method?.primary?.variationMode === 'aggressive' ? 'empathetic' : 'direct', trigger: 'low_engagement' },
  ].filter(f => f.value);

  // ── Pre-flight Check (12 items) ───────────────────────────────────────────
  const preflightChecklist = {
    product:          !!(productBlock.productType && productBlock.outcome),
    pain_with_backup: !!(productBlock.selectedPain && productBlock.backupPains?.length > 0),
    differentiation:  !!(positioningBlock.selectedPositioning),
    core_message:     !!(strategyBlock.coreMessage),
    angles_3plus:     (strategyBlock.angles?.length || 0) >= 3,
    method:           !!(strategyBlock.method?.primary?.method),
    tone:             !!(strategyBlock.tone?.tone),
    platform:         !!(strategyBlock.platforms?.primary),
    assets:           (strategyBlock.assets?.required?.length || 0) > 0,
    funnel_complete:  !!(strategyBlock.funnel?.hook_strategy && strategyBlock.funnel?.conversion_method && strategyBlock.funnel?.trust_builder),
    test_plan:        !!(testPlan?.hypotheses?.length > 0),
    metrics:          !!(metrics?.payment?.kpi),
  };
  const preflightPassed = Object.values(preflightChecklist).filter(Boolean).length;
  const preflightTotal  = Object.keys(preflightChecklist).length;
  const preflightReady  = preflightPassed === preflightTotal;

  const goSignal = realityCheck?.go_signal ||
    (confidence >= 70 ? 'ירוק' : confidence >= 45 ? 'צהוב' : 'אדום');

  return {
    // Identity
    job_id:             jobId,
    user_id:            userId,
    research_report_id: researchReportId,
    niche,
    // Output Contract
    product:            productBlock,
    positioning:        positioningBlock,
    strategy:           strategyBlock,
    test_plan:          testPlan || {},
    metrics:            metrics  || {},
    risks:              risks    || [],
    fallback_options:   fallbackOptions,
    // Validation & Reality
    validation:         { status: validation?.status, passed: validation?.passed, total: validation?.total, checks: validation?.checks },
    reality_check:      realityCheck,
    preflight:          { checklist: preflightChecklist, passed: preflightPassed, total: preflightTotal, ready: preflightReady },
    // Meta
    confidence,
    ai_calls_made:      aiCallsMade,
    generation_ms:      generationMs,
    go_signal:          goSignal,
  };
}

module.exports = { buildStrategyReport };
