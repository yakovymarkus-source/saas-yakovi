'use strict';
/**
 * execution/core/decision-layer.js
 * Execution Decision Layer:
 *   - Variant strategy (how many, what types)
 *   - Intensity (1-5 scale)
 *   - Depth (short / medium / deep)
 *   - Execution mode table
 *   - Asset-level routing
 */

const INTENSITY_SCALE = {
  1: { label: 'מינימלי',   description: 'בסיסי ביותר, ללא לחץ, ניסיוני' },
  2: { label: 'נמוך',      description: 'רגוע, בונה אמון, educational' },
  3: { label: 'בינוני',    description: 'מאוזן, עם הוכחה חברתית, ברור' },
  4: { label: 'גבוה',      description: 'דחיפות, הוכחות חזקות, ישיר' },
  5: { label: 'אגרסיבי',   description: 'מקסימום דחיפות, FOMO, ישיר לגמרי' },
};

const DEPTH_MAP = {
  short:  { label: 'קצר',    wordRange: [30, 80],   hookCount: 1, adVariants: 1 },
  medium: { label: 'בינוני', wordRange: [80, 200],  hookCount: 2, adVariants: 2 },
  deep:   { label: 'עמוק',   wordRange: [200, 500], hookCount: 3, adVariants: 3 },
};

const EXECUTION_MODES_TABLE = {
  draft: {
    variantCount:   1,
    withFeedback:   false,
    withRanking:    false,
    assetDepth:     'short',
    parallelAssets: false,
    label:          'טיוטה',
  },
  smart: {
    variantCount:   3,
    withFeedback:   true,
    withRanking:    true,
    assetDepth:     'medium',
    parallelAssets: true,
    label:          'חכם',
  },
  premium: {
    variantCount:   5,
    withFeedback:   true,
    withRanking:    true,
    assetDepth:     'deep',
    parallelAssets: true,
    label:          'פרימיום',
  },
};

function buildDecisionProfile(brief, awarenessProfile) {
  const { executionMode, platform, confidence, method, tone, goSignal } = brief;

  // ── Execution mode params ─────────────────────────────────────────────────
  const modeParams = EXECUTION_MODES_TABLE[executionMode] || EXECUTION_MODES_TABLE.draft;

  // ── Intensity (1-5) based on awareness + go_signal + method ──────────────
  const intensity = _computeIntensity({ awarenessProfile, goSignal, method, confidence });

  // ── Depth based on platform + asset type ─────────────────────────────────
  const depth = _computeDepth({ platform, executionMode, method });

  // ── Variant strategy ──────────────────────────────────────────────────────
  const variantStrategy = _buildVariantStrategy({
    variantCount: modeParams.variantCount,
    method,
    awarenessProfile,
    tone,
    platform,
  });

  // ── Per-asset routing ─────────────────────────────────────────────────────
  const assetRouting = _buildAssetRouting({ brief, awarenessProfile, intensity, depth });

  return {
    mode:            executionMode,
    modeParams,
    intensity,
    intensityProfile: INTENSITY_SCALE[intensity],
    depth,
    depthProfile:    DEPTH_MAP[depth],
    variantStrategy,
    assetRouting,
  };
}

function _computeIntensity({ awarenessProfile, goSignal, method, confidence }) {
  let base = 3;
  if (awarenessProfile?.index >= 3) base += 1;   // product_aware → push harder
  if (awarenessProfile?.index <= 0) base -= 1;   // unaware → softer
  if (goSignal === 'ירוק')  base += 1;
  if (goSignal === 'אדום')  base -= 1;
  if ((method?.primary?.method || '') === 'direct_response') base += 1;
  if ((method?.primary?.method || '') === 'emotional_story') base -= 1;
  if (confidence >= 80) base += 1;
  return Math.max(1, Math.min(5, base));
}

function _computeDepth({ platform, executionMode, method }) {
  if (executionMode === 'draft') return 'short';
  if (executionMode === 'premium') return 'deep';
  // smart: platform-based
  if (['tiktok', 'instagram'].includes(platform)) return 'short';
  if (['youtube', 'email'].includes(platform))    return 'deep';
  return 'medium';
}

function _buildVariantStrategy({ variantCount, method, awarenessProfile, tone, platform }) {
  const methodKey = method?.primary?.method || 'direct_response';
  const toneKey   = tone?.tone || 'direct';

  const VARIATION_THEMES = [
    { name: 'primary',    tone: toneKey,        method: methodKey,            label: 'ראשי' },
    { name: 'contrast',   tone: 'empathetic',   method: 'emotional_story',    label: 'ניגוד רגשי' },
    { name: 'proof',      tone: 'authority',    method: 'social_proof',       label: 'הוכחה חברתית' },
    { name: 'direct',     tone: 'direct',       method: 'direct_response',    label: 'ישיר' },
    { name: 'curiosity',  tone: 'conversational',method: 'educational',       label: 'סקרנות' },
  ];

  return VARIATION_THEMES.slice(0, variantCount).map((theme, i) => ({
    variantIndex: i,
    ...theme,
    awarenessAdjustment: awarenessProfile?.level || 'problem_aware',
  }));
}

function _buildAssetRouting({ brief, awarenessProfile, intensity, depth }) {
  const routing = {};
  for (const assetType of (brief.assetTypes || [])) {
    routing[assetType] = _routeAsset({ assetType, brief, awarenessProfile, intensity, depth });
  }
  return routing;
}

function _routeAsset({ assetType, brief, awarenessProfile, intensity, depth }) {
  const depthProfile = DEPTH_MAP[depth];
  const behavior     = awarenessProfile?.behavior || {};

  const base = {
    depth,
    intensity,
    wordRange:   depthProfile?.wordRange || [80, 200],
    hookCount:   depthProfile?.hookCount || 2,
    ctaStrength: behavior.ctaStrength || 'medium',
    hookApproach: behavior.hookApproach || 'pain_agitation',
    openingLine:  behavior.openingLine  || 'pain_statement',
  };

  switch (assetType) {
    case 'ads':
      return { ...base, format: behavior.adFormat || 'problem_solution', charLimit: 125, maxHooks: 5 };
    case 'landing_page':
      return { ...base, format: behavior.landingFocus || 'solution_differentiation', sections: _lpSections(intensity, awarenessProfile) };
    case 'email':
      return { ...base, format: behavior.emailSequence || 'solution_education', sequenceLength: intensity >= 4 ? 5 : 3 };
    case 'hooks':
      return { ...base, format: behavior.hookApproach, count: depthProfile?.hookCount || 2 };
    case 'scripts':
      return { ...base, format: 'video_script', durationSecs: depth === 'deep' ? 90 : 60 };
    case 'cta':
      return { ...base, format: 'cta_variants', count: 3 };
    default:
      return base;
  }
}

function _lpSections(intensity, awarenessProfile) {
  const base = ['hero', 'pain_block', 'solution', 'how_it_works', 'proof', 'offer', 'faq', 'cta'];
  if (intensity >= 4) base.splice(5, 0, 'urgency_block');
  if (awarenessProfile?.index <= 1) base.splice(2, 0, 'education_block');
  return base;
}

module.exports = { buildDecisionProfile, INTENSITY_SCALE, DEPTH_MAP, EXECUTION_MODES_TABLE };
