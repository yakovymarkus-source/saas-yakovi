'use strict';
/**
 * execution/core/input-normalizer.js
 * Validates and normalizes execution brief.
 * Smart-completes missing fields from strategy report.
 */

const VALID_ASSET_TYPES = ['ads', 'landing_page', 'email', 'hooks', 'scripts', 'cta'];
const VALID_EXECUTION_MODES = ['draft', 'smart', 'premium'];
const VALID_PLATFORMS = ['meta', 'instagram', 'tiktok', 'google', 'youtube', 'linkedin', 'email'];

const MODE_VARIANT_COUNT = { draft: 1, smart: 3, premium: 5 };

// Minimum Viable Brief — fields required to proceed
const MINIMUM_VIABLE_BRIEF = ['selectedPain', 'coreMessage', 'platform'];

// Stop conditions — when the agent should NOT proceed
const STOP_CONDITIONS = [
  { id: 'missing_offer',        test: b => !b.coreMessage && !b.outcome,            message: 'חסר offer/מסר מרכזי — הסוכן לא יכול לייצר ללא כיוון ברור' },
  { id: 'missing_audience',     test: b => !b.selectedPain && !b.targetCustomer,    message: 'חסר קהל יעד וכאב — הסוכן לא יכול להתאים מסר' },
  { id: 'contradicting_inputs', test: b => b.confidence < 30 && b.goSignal === 'אדום', message: 'confidence נמוך מאוד + אות אדום — בריף לא בשל לביצוע' },
  { id: 'no_differentiation',   test: b => !b.positioning && !b.whyUs && !b.angles?.length, message: 'אין בידול — כל הנכסים יצאו generic ללא ערך' },
];

function normalizeInput({ strategyReport, assetTypes, executionMode, platform, customBrief }) {
  const errors = [];
  const warnings = [];

  // ── Validate strategy report ───────────────────────────────────────────────
  if (!strategyReport) {
    errors.push('strategy_report_missing');
  }
  const product    = strategyReport?.product    || {};
  const positioning = strategyReport?.positioning || {};
  const strategy   = strategyReport?.strategy   || {};
  const testPlan   = strategyReport?.test_plan  || {};
  const metrics    = strategyReport?.metrics    || {};

  // ── Validate / smart-complete assetTypes ──────────────────────────────────
  let normalizedAssets = [];
  if (!assetTypes || assetTypes.length === 0) {
    normalizedAssets = _inferAssetsFromStrategy(strategy);
    warnings.push('asset_types_inferred_from_strategy');
  } else {
    normalizedAssets = assetTypes.filter(a => VALID_ASSET_TYPES.includes(a));
    const invalid = assetTypes.filter(a => !VALID_ASSET_TYPES.includes(a));
    if (invalid.length > 0) warnings.push(`invalid_asset_types_ignored: ${invalid.join(',')}`);
    if (normalizedAssets.length === 0) {
      normalizedAssets = _inferAssetsFromStrategy(strategy);
      warnings.push('asset_types_replaced_with_inferred');
    }
  }

  // ── Validate / smart-complete executionMode ───────────────────────────────
  let normalizedMode = executionMode;
  if (!VALID_EXECUTION_MODES.includes(executionMode)) {
    normalizedMode = _inferModeFromConfidence(strategyReport?.confidence);
    warnings.push(`execution_mode_inferred: ${normalizedMode}`);
  }

  // ── Validate / smart-complete platform ────────────────────────────────────
  let normalizedPlatform = platform;
  if (!VALID_PLATFORMS.includes(platform)) {
    normalizedPlatform = strategy?.platforms?.primary || 'meta';
    warnings.push(`platform_inferred: ${normalizedPlatform}`);
  }

  // ── Build normalized brief ─────────────────────────────────────────────────
  // ── Business context inference ────────────────────────────────────────────
  const businessContext = _inferBusinessContext({ product, strategy, strategyReport, customBrief });

  const brief = {
    // Core pain & product
    selectedPain:      product.selectedPain  || customBrief?.pain || null,
    productType:       product.productType   || null,
    productName:       product.productName   || null,
    outcome:           product.outcome       || null,
    viabilityScore:    product.viabilityScore || 0,

    // Positioning
    positioning:       positioning.selectedPositioning || null,
    angleType:         positioning.angleType  || null,
    whyUs:             positioning.whyUs      || null,

    // Strategy
    coreMessage:       strategy.coreMessage   || null,
    angles:            strategy.angles        || [],
    method:            strategy.method        || null,
    tone:              strategy.tone          || null,
    funnel:            strategy.funnel        || null,
    targetCustomer:    strategy.targetCustomer || null,
    coherence:         strategy.coherence     || null,

    // Execution params
    assetTypes:        normalizedAssets,
    executionMode:     normalizedMode,
    variantCount:      MODE_VARIANT_COUNT[normalizedMode] || 1,
    platform:          normalizedPlatform,

    // Test & metrics context
    hypotheses:        testPlan.hypotheses    || [],
    kpi:               metrics?.payment?.kpi  || null,

    // Confidence & signals
    confidence:        strategyReport?.confidence || 0,
    goSignal:          strategyReport?.go_signal  || 'צהוב',
    preflight:         strategyReport?.preflight  || null,

    // Business context
    ...businessContext,

    // Custom overrides
    ...(customBrief || {}),
  };

  // ── Minimum Viable Brief check ─────────────────────────────────────────────
  for (const field of MINIMUM_VIABLE_BRIEF) {
    if (!brief[field]) errors.push(`missing_${field}`);
  }

  // ── Stop conditions check ─────────────────────────────────────────────────
  const stopConditions = STOP_CONDITIONS.filter(c => c.test(brief));
  if (stopConditions.length > 0) {
    warnings.push(...stopConditions.map(c => `STOP: ${c.message}`));
    // Only hard-stop if confidence is critically low AND multiple conditions triggered
    if (stopConditions.length >= 2 && brief.confidence < 30) {
      errors.push(`stop_conditions: ${stopConditions.map(c => c.id).join(', ')}`);
    }
  }

  if (!brief.selectedPain) errors.push('missing_selected_pain');
  if (!brief.coreMessage)  errors.push('missing_core_message');
  if (!brief.method)        warnings.push('missing_method_will_infer');

  return {
    brief,
    valid:    errors.length === 0,
    errors,
    warnings,
  };
}

function _inferBusinessContext({ product, strategy, strategyReport, customBrief }) {
  const productType = product.productType || '';
  const price       = product.viabilityScore >= 70 ? 'high' : 'medium';

  // B2B vs B2C inference
  const customer    = (strategy.targetCustomer || '').toLowerCase();
  const isB2B       = /עסק|חברה|ארגון|b2b|מנכ|cmo|marketing|agency/.test(customer);

  // Product maturity
  const isNew       = !strategyReport?.created_at ||
    (Date.now() - new Date(strategyReport.created_at).getTime()) < 7 * 24 * 60 * 60 * 1000;

  // User level (affects copy complexity)
  const userLevel   = customBrief?.userLevel || 'standard';

  return {
    businessType:   isB2B ? 'b2b' : 'b2c',
    priceTier:      price,
    productMaturity: isNew ? 'new' : 'established',
    userLevel,
    requiresSimpleLanguage: userLevel === 'beginner',
  };
}

function _inferAssetsFromStrategy(strategy) {
  const method = strategy?.method?.primary?.method || '';
  const platform = strategy?.platforms?.primary || '';
  const assets = ['hooks', 'cta'];
  if (['meta','instagram','tiktok'].includes(platform)) assets.push('ads');
  if (['direct_response','emotional_story','social_proof'].includes(method)) assets.push('landing_page');
  if (platform === 'email') assets.push('email');
  if (['youtube','tiktok'].includes(platform)) assets.push('scripts');
  return [...new Set(assets)];
}

function _inferModeFromConfidence(confidence) {
  if (!confidence) return 'draft';
  if (confidence >= 75) return 'smart';
  if (confidence >= 85) return 'premium';
  return 'draft';
}

module.exports = { normalizeInput, VALID_ASSET_TYPES, VALID_EXECUTION_MODES, MODE_VARIANT_COUNT, MINIMUM_VIABLE_BRIEF, STOP_CONDITIONS };
