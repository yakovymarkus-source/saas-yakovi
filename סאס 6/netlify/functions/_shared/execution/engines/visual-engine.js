'use strict';
/**
 * execution/engines/visual-engine.js
 * Visual Engine — generates visual concept briefs for each asset type.
 * Outputs structured creative briefs for a design team / AI image generation.
 * Uses platform behavior rules + visual angle variants.
 */

const { generateVisualConcept } = require('../collectors/claude-execution-engine');
const { getPlatformBehavior }    = require('../core/platform-behavior');
const { VISUAL_ANGLE_TYPES }     = require('../core/angle-tester');

async function runVisualEngine({ brief, messageCore, awarenessProfile, decisionProfile, textAssets, angleProfile, onStep }) {
  const { assetTypes, platform, executionMode } = brief;
  // draft mode skips visual (optional optimization)
  if (executionMode === 'draft') return { skipped: true, reason: 'draft_mode' };

  const results          = {};
  const platformBehavior = getPlatformBehavior(platform);
  const visualAngles     = angleProfile?.visualAngles || [];

  // ── Ad Visuals ────────────────────────────────────────────────────────────
  if (assetTypes.includes('ads')) {
    onStep?.('visual_ads_start');
    const adVariants   = textAssets?.ads || [];
    const visualVariants = [];
    for (let i = 0; i < adVariants.length; i++) {
      // Use angle-specific visual type
      const visualType = visualAngles[i]?.visualType || VISUAL_ANGLE_TYPES[i % VISUAL_ANGLE_TYPES.length];
      const concept    = await generateVisualConcept({
        brief: { ...brief, visualType, platformBehavior },
        messageCore, awarenessProfile, assetType: 'ad',
      });
      visualVariants.push({
        variantIndex:  i,
        visualType,
        adHeadline:    adVariants[i]?.text?.headline || adVariants[i]?.headline || '',
        platformSpecs: { ratio: platformBehavior.aspectRatios?.[0], maxText: platformBehavior.textOnImageMax },
        ...concept,
      });
    }
    results.ads = visualVariants;
    onStep?.('visual_ads_done', { count: visualVariants.length });
  }

  // ── Landing Page Visuals ──────────────────────────────────────────────────
  if (assetTypes.includes('landing_page')) {
    onStep?.('visual_lp_start');
    const lpVisual = await generateVisualConcept({
      brief: { ...brief, visualType: 'solution_scene' },
      messageCore, awarenessProfile, assetType: 'landing_page',
    });
    results.landing_page = { ...lpVisual, visualType: 'solution_scene' };
    onStep?.('visual_lp_done');
  }

  // ── Script / Video Visuals ────────────────────────────────────────────────
  if (assetTypes.includes('scripts')) {
    onStep?.('visual_scripts_start');
    const scriptVariants = textAssets?.scripts || [];
    const videoVisuals   = [];
    for (let i = 0; i < scriptVariants.length; i++) {
      const visualType = visualAngles[i]?.visualType || 'demo';
      const concept    = await generateVisualConcept({
        brief: { ...brief, visualType },
        messageCore, awarenessProfile, assetType: 'video',
      });
      videoVisuals.push({
        variantIndex: i,
        visualType,
        // Platform-specific video rules
        platformRule: platformBehavior.hookRule,
        hookWindow:   platformBehavior.videoHookSec,
        retention:    platformBehavior.retentionRule || null,
        ...concept,
      });
    }
    results.scripts = videoVisuals;
    onStep?.('visual_scripts_done');
  }

  // ── Branding Direction ────────────────────────────────────────────────────
  results.brandingDirection = _buildBrandingDirection({ brief, awarenessProfile, platformBehavior });

  return results;
}

function _buildBrandingDirection({ brief, awarenessProfile, platformBehavior }) {
  const { platform, tone, productType } = brief;
  const level    = awarenessProfile?.level || 'problem_aware';
  const toneKey  = tone?.tone || 'direct';

  const PLATFORM_SPECS = {
    meta:      { ratio: '1:1 or 4:5', max_text: '20%', format: 'image or carousel' },
    instagram: { ratio: '1:1 or 9:16', max_text: '20%', format: 'image, story, reel' },
    tiktok:    { ratio: '9:16', max_text: 'minimal', format: 'video only' },
    google:    { ratio: 'responsive', max_text: 'headline 30 chars', format: 'responsive display' },
    youtube:   { ratio: '16:9', max_text: 'overlay', format: 'video + thumbnail' },
    linkedin:  { ratio: '1.91:1', max_text: '30%', format: 'image or document' },
  };

  const COLOR_BY_TONE = {
    authority:      { primary: '#1a1a2e', accent: '#e94560', feeling: 'power/trust' },
    empathetic:     { primary: '#667eea', accent: '#48bb78', feeling: 'warmth/safety' },
    direct:         { primary: '#2d3748', accent: '#f6ad55', feeling: 'clarity/action' },
    inspiring:      { primary: '#553c9a', accent: '#ee4b2b', feeling: 'energy/motivation' },
    educational:    { primary: '#2b6cb0', accent: '#38a169', feeling: 'trust/knowledge' },
    conversational: { primary: '#4a5568', accent: '#63b3ed', feeling: 'friendly/approachable' },
  };

  const AWARENESS_IMAGERY = {
    unaware:        'lifestyle/aspirational — show the after state',
    problem_aware:  'pain visualization — show the problem being solved',
    solution_aware: 'product/comparison — show why this solution is different',
    product_aware:  'trust/social proof — show happy customers or results',
  };

  return {
    platformSpecs:  PLATFORM_SPECS[platform] || PLATFORM_SPECS.meta,
    colorDirection: COLOR_BY_TONE[toneKey]   || COLOR_BY_TONE.direct,
    imageryGuidance: AWARENESS_IMAGERY[level] || AWARENESS_IMAGERY.problem_aware,
    fontStyle:       toneKey === 'authority' ? 'serif/bold' : 'clean sans-serif',
    whitespace:      'generous — avoid cluttered layouts',
  };
}

module.exports = { runVisualEngine };
