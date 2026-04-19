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

    // Custom overrides
    ...(customBrief || {}),
  };

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

module.exports = { normalizeInput, VALID_ASSET_TYPES, VALID_EXECUTION_MODES, MODE_VARIANT_COUNT };
