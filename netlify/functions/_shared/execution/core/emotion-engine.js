'use strict';
/**
 * execution/core/emotion-engine.js
 * Emotional Targeting Layer.
 * Maps pain/desire/context to primary emotion, then adjusts copy style.
 * Emotions: fear, frustration, desire, hope, relief
 */

const EMOTION_PROFILES = {
  fear: {
    label:        'פחד',
    description:  'הקהל חושש שהם יפסידו, יכשלו, או ייפגעו',
    copyTriggers: ['מה יקרה אם לא...', 'אתה מסתכן ב...', 'אל תחכה עד ש...'],
    hookStyle:    'threat_based',
    cta:          'urgent',
    intensity:    4,
    wordsToUse:   ['סיכון', 'לאבד', 'לפספס', 'בסכנה', 'לפני שמאוחר'],
    wordsToAvoid: ['אולי', 'שקול', 'כדאי'],
  },
  frustration: {
    label:        'תסכול',
    description:  'הקהל עייף ומתוסכל ממצב שלא משתנה',
    copyTriggers: ['נמאס לך מ...', 'כבר ניסית הכל ועדיין...', 'זה לא הגיוני ש...'],
    hookStyle:    'pain_agitation',
    cta:          'medium',
    intensity:    3,
    wordsToUse:   ['נמאס', 'עייף', 'שוב', 'תמיד', 'בסוף'],
    wordsToAvoid: ['נסה', 'אולי', 'בהדרגה'],
  },
  desire: {
    label:        'תשוקה',
    description:  'הקהל רוצה להשיג משהו — מונע על ידי שאיפה',
    copyTriggers: ['דמיין שאתה...', 'מה אם היית יכול...', 'הדרך הקצרה ל...'],
    hookStyle:    'aspiration',
    cta:          'medium',
    intensity:    3,
    wordsToUse:   ['הגשמה', 'להשיג', 'לבנות', 'לצמוח', 'ביטחון'],
    wordsToAvoid: ['בעיה', 'כאב', 'מסובך'],
  },
  hope: {
    label:        'תקווה',
    description:  'הקהל מאמין ששינוי אפשרי — צריך אישור',
    copyTriggers: ['יש דרך...', 'אנשים כמוך כבר הצליחו...', 'זה אפשרי גם בשבילך...'],
    hookStyle:    'possibility',
    cta:          'soft',
    intensity:    2,
    wordsToUse:   ['אפשרי', 'הצלחה', 'לך', 'יחד', 'שינוי'],
    wordsToAvoid: ['קשה', 'מאתגר', 'לא בטוח'],
  },
  relief: {
    label:        'הקלה',
    description:  'הקהל עייף ורוצה שהבעיה תפסיק — לא הצלחה גדולה, רק שקט',
    copyTriggers: ['סוף סוף פתרון ל...', 'בלי עוד...', 'פשוט תפסיק לסבול מ...'],
    hookStyle:    'pain_removal',
    cta:          'soft',
    intensity:    2,
    wordsToUse:   ['סוף סוף', 'בלי', 'פשוט', 'קל', 'אוטומטי'],
    wordsToAvoid: ['גדול', 'ביצועים', 'אסטרטגיה'],
  },
};

const METHOD_TO_EMOTION = {
  emotional_story:  'desire',
  social_proof:     'hope',
  direct_response:  'frustration',
  educational:      'hope',
  authority:        'fear',
  contrast:         'frustration',
};

const PAIN_PATTERN_TO_EMOTION = {
  'כסף|הכנסה|פרנסה':         'fear',
  'זמן|עסוק|תשוק':           'frustration',
  'לקוחות|מכירות|צמיחה':     'desire',
  'ביטחון|ערך|מה שווה':       'hope',
  'מיצוי|מצב|לא יכול':       'relief',
  'כישלון|נכשל|לא עובד':     'frustration',
  'ללמוד|לדעת|להבין':         'desire',
  'מתחרים|לפגר|שוק':         'fear',
};

function buildEmotionProfile(brief, awarenessProfile) {
  const { method, selectedPain, tone } = brief;

  // Primary emotion inference
  const primaryEmotion = _inferPrimaryEmotion({ method, selectedPain, awarenessProfile });
  const profile        = EMOTION_PROFILES[primaryEmotion] || EMOTION_PROFILES.frustration;

  // Secondary emotion (for variants)
  const secondaryEmotion = _inferSecondaryEmotion(primaryEmotion, awarenessProfile);

  // Emotion-based intensity adjustment
  const intensityAdjust = profile.intensity;

  // Copy style recommendations
  const copyStyle = _buildCopyStyle({ profile, awarenessProfile });

  return {
    primary:           primaryEmotion,
    primaryProfile:    profile,
    secondary:         secondaryEmotion,
    secondaryProfile:  EMOTION_PROFILES[secondaryEmotion] || null,
    intensityAdjust,
    copyStyle,
    wordsToUse:        profile.wordsToUse,
    wordsToAvoid:      profile.wordsToAvoid,
    hookStyle:         profile.hookStyle,
    ctaAdjustment:     profile.cta,
  };
}

function _inferPrimaryEmotion({ method, selectedPain, awarenessProfile }) {
  // Method-based
  if (METHOD_TO_EMOTION[method?.primary?.method]) {
    return METHOD_TO_EMOTION[method.primary.method];
  }

  // Pain pattern matching
  if (selectedPain) {
    for (const [pattern, emotion] of Object.entries(PAIN_PATTERN_TO_EMOTION)) {
      if (new RegExp(pattern, 'i').test(selectedPain)) return emotion;
    }
  }

  // Awareness-based fallback
  const awarenessDefaults = {
    unaware:        'desire',
    problem_aware:  'frustration',
    solution_aware: 'fear',
    product_aware:  'desire',
  };
  return awarenessDefaults[awarenessProfile?.level] || 'frustration';
}

function _inferSecondaryEmotion(primary, awarenessProfile) {
  const SECONDARY_MAP = {
    fear:        'hope',
    frustration: 'desire',
    desire:      'fear',
    hope:        'relief',
    relief:      'frustration',
  };
  return SECONDARY_MAP[primary] || 'hope';
}

function _buildCopyStyle({ profile, awarenessProfile }) {
  const sentenceLength = profile.intensity >= 4 ? 'short' : profile.intensity <= 2 ? 'medium' : 'varied';
  const punctuation    = profile.intensity >= 4 ? 'aggressive' : 'standard';
  const questions      = profile.hookStyle === 'pain_agitation' || profile.hookStyle === 'threat_based';
  const storyelements  = awarenessProfile?.index <= 1;

  return {
    sentenceLength,
    punctuation,
    useQuestions:   questions,
    useStoryOpener: storyelements,
    power_words:    profile.wordsToUse,
    avoid_words:    profile.wordsToAvoid,
  };
}

function getEmotionForVariant(variantIndex, primaryEmotion, secondaryEmotion) {
  // Alternate emotions across variants
  if (variantIndex % 3 === 0) return primaryEmotion;
  if (variantIndex % 3 === 1) return secondaryEmotion;
  return 'hope'; // third variant always ends hopeful
}

module.exports = { buildEmotionProfile, getEmotionForVariant, EMOTION_PROFILES };
