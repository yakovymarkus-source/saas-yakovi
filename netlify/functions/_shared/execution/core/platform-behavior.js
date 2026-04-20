'use strict';
/**
 * execution/core/platform-behavior.js
 * Platform-specific behavior rules and constraints.
 * Each platform has distinct audience behavior that determines HOW to write, not just length.
 */

const PLATFORM_BEHAVIORS = {
  meta: {
    name:            'Meta / Facebook',
    hookRule:        'first 3 lines determine if user stops scrolling — must grab immediately',
    hookWindow:      '2-3 seconds',
    primaryFormat:   'text + image or video',
    audienceBehavior: 'browsing casually, not actively searching',
    copyStyle:       'conversational → educate → offer',
    maxBodyChars:    125,
    maxHeadlineChars: 40,
    restrictedClaims: ['guaranteed', 'best results', 'cure', 'without effort'],
    textOnImageMax:  '20%',
    bestHookTypes:   ['question', 'stat', 'pain', 'story_opener'],
    ctaTone:         'friendly but clear',
    mobilePriority:  true,
    videoHookSec:    3,
    aspectRatios:    ['1:1', '4:5', '9:16'],
    notes:           'לא לציין מחירים ישירות בטקסט המודעה אם לא חייבים',
  },
  instagram: {
    name:            'Instagram',
    hookRule:        'visual-first — first frame is the hook',
    hookWindow:      '1-2 seconds',
    primaryFormat:   'image / reel / story',
    audienceBehavior: 'visual discovery, aspirational',
    copyStyle:       'short, punchy, aesthetic',
    maxBodyChars:    125,
    maxHeadlineChars: 40,
    restrictedClaims: ['guaranteed', 'best results'],
    textOnImageMax:  '20%',
    bestHookTypes:   ['visual', 'aspiration', 'contrast'],
    ctaTone:         'inspiring and clear',
    mobilePriority:  true,
    videoHookSec:    2,
    aspectRatios:    ['1:1', '9:16'],
    notes:           'הצגת "לפני ואחרי" עובדת חזק על Instagram',
  },
  tiktok: {
    name:            'TikTok',
    hookRule:        'FIRST SECOND IS EVERYTHING — must hook before blink',
    hookWindow:      '0-1 second',
    primaryFormat:   'short vertical video (15-60sec)',
    audienceBehavior: 'fast swipe, entertainment-first, trend-driven',
    copyStyle:       'aggressive, pattern-interrupt, humor or shock',
    maxBodyChars:    80,
    maxHeadlineChars: 25,
    restrictedClaims: ['guaranteed', 'best results', 'cure'],
    textOnImageMax:  'minimal',
    bestHookTypes:   ['shock', 'pattern_interrupt', 'controversy', 'curiosity'],
    ctaTone:         'casual and direct',
    mobilePriority:  true,
    videoHookSec:    1,
    aspectRatios:    ['9:16'],
    openingInstruction: 'פתח עם המשפט הכי חזק — לא הקדמה, לא context, ישר לעניין',
    notes:           'אל תסביר מוצר מורכב ב-TikTok — הבא לאוורנס בלבד',
  },
  google: {
    name:            'Google Ads',
    hookRule:        'user is SEARCHING — match intent, not interrupt',
    hookWindow:      'headline determines click',
    primaryFormat:   'text ad (RSA) or responsive display',
    audienceBehavior: 'active search — high intent',
    copyStyle:       'direct, benefits-focused, keyword-relevant',
    maxBodyChars:    90,
    maxHeadlineChars: 30,
    maxDescriptionChars: 90,
    restrictedClaims: ['#1', 'best', 'guaranteed'],
    bestHookTypes:   ['direct_benefit', 'solution_match', 'comparison'],
    ctaTone:         'action-oriented, clear',
    mobilePriority:  false,
    videoHookSec:    null,
    aspectRatios:    ['responsive'],
    notes:           'headline חייב להכיל את מילת המפתח הראשית — זה קריטי ל-QS',
  },
  youtube: {
    name:            'YouTube',
    hookRule:        'hook must work before 5-second skip — retention is the game',
    hookWindow:      '5 seconds',
    primaryFormat:   'video (15sec pre-roll or 30sec+)',
    audienceBehavior: 'watching content, willing to watch longer if engaged',
    copyStyle:       'story arc, education → offer',
    maxBodyChars:    null,
    maxHeadlineChars: 70,
    restrictedClaims: ['guaranteed', 'cure'],
    bestHookTypes:   ['curiosity', 'big_promise', 'controversy'],
    ctaTone:         'authoritative but approachable',
    mobilePriority:  false,
    videoHookSec:    5,
    aspectRatios:    ['16:9'],
    retentionRule:   'pattern interrupt every 30-45 seconds to maintain watch time',
    notes:           'thumbnail הוא חצי הקרב ב-YouTube — תמיד לתכנן thumbnail עם הסקריפט',
  },
  linkedin: {
    name:            'LinkedIn',
    hookRule:        'professional credibility first — authority hook',
    hookWindow:      '3-5 seconds',
    primaryFormat:   'text + image, document, video',
    audienceBehavior: 'professional mindset, B2B oriented, decision-maker',
    copyStyle:       'professional, data-driven, thought-leadership',
    maxBodyChars:    150,
    maxHeadlineChars: 70,
    restrictedClaims: ['spam-style claims'],
    bestHookTypes:   ['stat', 'insight', 'question', 'authority'],
    ctaTone:         'professional and respectful',
    mobilePriority:  false,
    videoHookSec:    5,
    aspectRatios:    ['1.91:1', '1:1'],
    notes:           'אנשי LinkedIn מגיבים לדאטה ולסיפורי הצלחה עסקיים — לא לטון B2C',
  },
  email: {
    name:            'Email',
    hookRule:        'subject line is the hook — open rate is the first win',
    hookWindow:      'subject line (5-7 words)',
    primaryFormat:   'text email (html optional)',
    audienceBehavior: 'opted-in, warmer audience, reading at own pace',
    copyStyle:       'personal, direct, conversational',
    maxBodyChars:    null,
    maxSubjectChars: 50,
    maxPreviewChars: 90,
    restrictedClaims: ['free money', 'act now', 'urgent'],
    bestHookTypes:   ['curiosity', 'personal', 'story', 'value'],
    ctaTone:         'personal and clear',
    mobilePriority:  true,
    videoHookSec:    null,
    notes:           'פתח בשם הנמען אם אפשר — personalization מעלה open rate ב-26%',
  },
};

const CTA_TYPES = {
  soft:       { label: 'רך',     examples: ['גלה עוד', 'קרא עוד', 'בדוק'], intensity: 1 },
  medium:     { label: 'בינוני', examples: ['שמור מקום', 'הצטרף חינם', 'נסה'], intensity: 3 },
  hard:       { label: 'חזק',    examples: ['קנה עכשיו', 'הצטרף היום'], intensity: 4 },
  curiosity:  { label: 'סקרנות', examples: ['גלה את הסוד', 'ראה מה קורה'], intensity: 2 },
  urgency:    { label: 'דחיפות', examples: ['רק היום', 'מקומות אחרונים', 'לפני שנגמר'], intensity: 5 },
};

function getPlatformBehavior(platform) {
  return PLATFORM_BEHAVIORS[platform] || PLATFORM_BEHAVIORS.meta;
}

function buildPlatformConstraints(platform) {
  const behavior = getPlatformBehavior(platform);
  return {
    maxBodyChars:     behavior.maxBodyChars,
    maxHeadlineChars: behavior.maxHeadlineChars,
    restrictedClaims: behavior.restrictedClaims || [],
    aspectRatios:     behavior.aspectRatios || [],
    textOnImageMax:   behavior.textOnImageMax || null,
    videoHookSec:     behavior.videoHookSec || null,
    hookRule:         behavior.hookRule,
    hookWindow:       behavior.hookWindow,
    notes:            behavior.notes || '',
  };
}

function selectCtaType({ awarenessLevel, platform, funnelStage, intensity }) {
  // Funnel stage drives CTA type
  if (funnelStage === 'top') {
    return awarenessLevel === 'unaware' ? 'curiosity' : 'soft';
  }
  if (funnelStage === 'bottom' || awarenessLevel === 'product_aware') {
    return intensity >= 4 ? 'urgency' : 'hard';
  }
  if (platform === 'tiktok') return 'curiosity';
  if (platform === 'google')  return 'hard';
  return 'medium';
}

function buildPlatformInstructions(platform, assetType) {
  const behavior = getPlatformBehavior(platform);
  const instructions = [];

  instructions.push(`פלטפורמה: ${behavior.name}`);
  instructions.push(`חוק hook: ${behavior.hookRule}`);
  instructions.push(`חלון hook: ${behavior.hookWindow}`);
  instructions.push(`סגנון כתיבה: ${behavior.copyStyle}`);

  if (behavior.maxBodyChars)     instructions.push(`מקסימום תווים בגוף: ${behavior.maxBodyChars}`);
  if (behavior.maxHeadlineChars) instructions.push(`מקסימום תווים ב-headline: ${behavior.maxHeadlineChars}`);
  if (behavior.openingInstruction) instructions.push(behavior.openingInstruction);
  if (behavior.notes)            instructions.push(`שים לב: ${behavior.notes}`);

  const bestHooks = behavior.bestHookTypes?.join(', ');
  if (bestHooks) instructions.push(`סוגי hook שעובדים: ${bestHooks}`);

  return instructions;
}

module.exports = {
  getPlatformBehavior,
  buildPlatformConstraints,
  selectCtaType,
  buildPlatformInstructions,
  PLATFORM_BEHAVIORS,
  CTA_TYPES,
};
