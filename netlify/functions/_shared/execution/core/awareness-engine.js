'use strict';
/**
 * execution/core/awareness-engine.js
 * 4-level awareness behavior mapping.
 * Determines how assets should be framed based on audience awareness level.
 *
 * Levels:
 *   unaware          — doesn't know they have the problem
 *   problem_aware    — knows the problem, doesn't know solutions exist
 *   solution_aware   — knows solutions exist, hasn't chosen one
 *   product_aware    — knows us, hasn't committed yet
 */

const AWARENESS_LEVELS = ['unaware', 'problem_aware', 'solution_aware', 'product_aware'];

const AWARENESS_BEHAVIORS = {
  unaware: {
    level:          'unaware',
    label:          'לא מודע לבעיה',
    hookApproach:   'curiosity_or_story',   // Lead with story or surprising insight
    openingLine:    'story_or_statistic',
    offerPosition:  'educate_first',         // Don't lead with product
    ctaStrength:    'soft',                  // "גלה עוד", "קרא עוד"
    contentDepth:   'educational',
    trustRequired:  'low',                   // Just needs to see the problem
    messageFocus:   'problem_reveal',
    adFormat:       'story_or_video',
    landingFocus:   'problem_education',
    emailSequence:  'awareness_nurture',
    warningNote:    'אל תמכור ישירות — הקהל לא יודע שיש לו בעיה',
  },
  problem_aware: {
    level:          'problem_aware',
    label:          'מודע לבעיה',
    hookApproach:   'pain_agitation',        // Hit the pain hard
    openingLine:    'pain_statement',
    offerPosition:  'solution_reveal',
    ctaStrength:    'medium',                // "גלה איך", "קבל את הפתרון"
    contentDepth:   'solution_focused',
    trustRequired:  'medium',
    messageFocus:   'solution_positioning',
    adFormat:       'problem_solution',
    landingFocus:   'solution_differentiation',
    emailSequence:  'solution_education',
    warningNote:    'המוקד הוא שהיש פתרון — לא עדיין מי אנחנו',
  },
  solution_aware: {
    level:          'solution_aware',
    label:          'מודע לפתרונות',
    hookApproach:   'differentiation',       // Why us vs competitors
    openingLine:    'comparison_or_contrast',
    offerPosition:  'why_us',
    ctaStrength:    'strong',                // "נסה עכשיו", "הצטרף"
    contentDepth:   'comparison_proof',
    trustRequired:  'high',
    messageFocus:   'unique_mechanism',
    adFormat:       'comparison_or_proof',
    landingFocus:   'proof_and_differentiation',
    emailSequence:  'objection_handling',
    warningNote:    'חייב להסביר מה שונה — הקהל כבר מכיר פתרונות אחרים',
  },
  product_aware: {
    level:          'product_aware',
    label:          'מכיר אותנו',
    hookApproach:   'offer_or_urgency',      // They know us — close the deal
    openingLine:    'direct_offer',
    offerPosition:  'direct_conversion',
    ctaStrength:    'urgent',                // "הצטרף עכשיו", "קנה היום"
    contentDepth:   'offer_focused',
    trustRequired:  'already_established',
    messageFocus:   'conversion_push',
    adFormat:       'direct_offer_or_retargeting',
    landingFocus:   'conversion_optimized',
    emailSequence:  'conversion_push',
    warningNote:    'הקהל מוכר — תן הצעה ברורה עם דחיפות',
  },
};

function inferAwarenessLevel(brief) {
  const { method, funnel, targetCustomer, goSignal, confidence } = brief;
  const methodKey = method?.primary?.method || '';
  const platform  = brief.platform || '';

  // Method-based inference
  if (methodKey === 'educational')      return 'problem_aware';
  if (methodKey === 'emotional_story')  return 'unaware';
  if (methodKey === 'social_proof')     return 'solution_aware';
  if (methodKey === 'direct_response')  return 'solution_aware';
  if (methodKey === 'contrast')         return 'problem_aware';
  if (methodKey === 'authority')        return 'solution_aware';

  // Platform-based inference
  if (platform === 'google')    return 'solution_aware';
  if (platform === 'tiktok')    return 'unaware';
  if (platform === 'linkedin')  return 'problem_aware';
  if (platform === 'email')     return 'product_aware';

  // Funnel-based inference
  const convMethod = funnel?.conversion_method || '';
  if (convMethod === 'direct_sale')    return 'product_aware';
  if (convMethod === 'free_content')   return 'problem_aware';
  if (convMethod === 'webinar')        return 'problem_aware';

  return 'problem_aware'; // safe default
}

function getAwarenessBehavior(level) {
  return AWARENESS_BEHAVIORS[level] || AWARENESS_BEHAVIORS.problem_aware;
}

function buildAwarenessProfile(brief) {
  const level    = brief.awarenessLevel || inferAwarenessLevel(brief);
  const behavior = getAwarenessBehavior(level);
  const index    = AWARENESS_LEVELS.indexOf(level);

  return {
    level,
    behavior,
    index,       // 0-3 (higher = more ready to buy)
    isReadyToBuy: index >= 2,
    requiresNurture: index <= 1,
  };
}

module.exports = { buildAwarenessProfile, inferAwarenessLevel, getAwarenessBehavior, AWARENESS_LEVELS, AWARENESS_BEHAVIORS };
