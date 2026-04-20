'use strict';
/**
 * execution/core/angle-tester.js
 * Angle Testing Logic.
 * Maps strategy angles to 5 psychological angle types.
 * Selects best angles per variant, distributes across variants for testing.
 */

const ANGLE_TYPES = {
  pain_based: {
    label:       'כאב',
    description: 'מתמקד בבעיה — מגביר מודעות לכאב ומציב את הפתרון כהקלה',
    hookPattern: 'אתה עדיין סובל מ...',
    mechanism:   'Negative motivation — move away from pain',
    bestFor:     ['problem_aware', 'solution_aware'],
    emotion:     'frustration',
    intensity:   4,
    example:     'כל בוקר אתה קם וחושב — למה אין לי עוד לקוחות?',
  },
  desire_based: {
    label:       'תשוקה',
    description: 'מתמקד בתוצאה הרצויה — מצייר את החיים האחרי',
    hookPattern: 'דמיין שאתה...',
    mechanism:   'Positive motivation — move toward desired state',
    bestFor:     ['unaware', 'problem_aware'],
    emotion:     'desire',
    intensity:   3,
    example:     'דמיין שלקוחות חדשים מגיעים אליך אוטומטית כל שבוע',
  },
  fear_based: {
    label:       'פחד',
    description: 'מתמקד בסיכון — מה יאבד אם לא יפעל עכשיו',
    hookPattern: 'בלי זה אתה מסתכן ב...',
    mechanism:   'Loss aversion — fear of missing out or losing',
    bestFor:     ['solution_aware', 'product_aware'],
    emotion:     'fear',
    intensity:   5,
    example:     'כל יום בלי מערכת זה יום שהמתחרים שלך מתקדמים',
  },
  status_based: {
    label:       'סטטוס',
    description: 'מתמקד בזהות — מי הם אחרי שמשתמשים במוצר',
    hookPattern: 'אנשים כמוך שהחליטו...',
    mechanism:   'Identity and social proof — who I become',
    bestFor:     ['unaware', 'solution_aware', 'product_aware'],
    emotion:     'desire',
    intensity:   3,
    example:     '347 יזמים כמוך כבר בנו מכונת לקוחות אוטומטית',
  },
  logic_based: {
    label:       'לוגיקה',
    description: 'מתמקד בהיגיון — ROI, נתונים, השוואות ועובדות',
    hookPattern: 'הנתונים מראים ש...',
    mechanism:   'Rational decision-making — numbers and facts',
    bestFor:     ['solution_aware', 'product_aware'],
    emotion:     'hope',
    intensity:   2,
    example:     '92% מהעסקים שמשתמשים בשיטה רואים תוצאות תוך 30 יום',
  },
};

const VISUAL_ANGLE_TYPES = [
  'problem_scene',   // showing the pain situation
  'solution_scene',  // showing the product in use
  'before_after',    // transformation comparison
  'demo',            // product demonstration
  'testimonial',     // social proof visual
];

function buildAngleTesting({ brief, awarenessProfile, variantCount, existingAngles }) {
  const { method, selectedPain, tone } = brief;
  const level    = awarenessProfile?.level || 'problem_aware';
  const existing = existingAngles || [];

  // Score each angle type for this brief
  const scored = _scoreAngles({ level, method, tone, selectedPain });

  // Select angles for variants — diverse distribution
  const selected = _selectAngles({ scored, variantCount, existing });

  // Build variant-angle mapping
  const variantAngles = selected.map((angle, i) => ({
    variantIndex: i,
    angleType:    angle.type,
    angleProfile: ANGLE_TYPES[angle.type],
    score:        angle.score,
    hookPattern:  ANGLE_TYPES[angle.type]?.hookPattern || '',
    emotion:      ANGLE_TYPES[angle.type]?.emotion || 'frustration',
    intensity:    ANGLE_TYPES[angle.type]?.intensity || 3,
  }));

  // Build visual angle mapping
  const visualAngles = _assignVisualAngles(selected, variantCount);

  return {
    scored,
    selected:     variantAngles,
    visualAngles,
    primaryAngle: selected[0]?.type || 'pain_based',
    angleDistribution: selected.map(a => a.type),
  };
}

function _scoreAngles({ level, method, tone, selectedPain }) {
  const scores = {};

  for (const [type, profile] of Object.entries(ANGLE_TYPES)) {
    let score = 50;

    // Awareness level fit
    if (profile.bestFor.includes(level)) score += 20;

    // Method fit
    const METHOD_ANGLE_FIT = {
      emotional_story:  { desire_based: 15, pain_based: 10 },
      social_proof:     { status_based: 15, logic_based: 10 },
      direct_response:  { pain_based: 15, fear_based: 10 },
      educational:      { logic_based: 15, desire_based: 5 },
      authority:        { logic_based: 10, status_based: 10 },
      contrast:         { pain_based: 10, fear_based: 5 },
    };
    const methodKey = method?.primary?.method || '';
    score += (METHOD_ANGLE_FIT[methodKey]?.[type] || 0);

    // Tone fit
    const TONE_ANGLE_FIT = {
      authority:       { logic_based: 10, status_based: 5 },
      empathetic:      { pain_based: 10, desire_based: 5 },
      direct:          { pain_based: 10, fear_based: 5 },
      inspiring:       { desire_based: 15, status_based: 5 },
      educational:     { logic_based: 15 },
    };
    const toneKey = tone?.tone || '';
    score += (TONE_ANGLE_FIT[toneKey]?.[type] || 0);

    scores[type] = score;
  }

  return Object.entries(scores)
    .map(([type, score]) => ({ type, score }))
    .sort((a, b) => b.score - a.score);
}

function _selectAngles({ scored, variantCount, existing }) {
  const count   = variantCount || 1;
  const used    = new Set(existing);
  const result  = [];

  for (const angle of scored) {
    if (result.length >= count) break;
    if (!used.has(angle.type)) {
      result.push(angle);
      used.add(angle.type);
    }
  }

  // Fill remaining with top scored (if not enough unique)
  for (const angle of scored) {
    if (result.length >= count) break;
    if (!result.find(r => r.type === angle.type)) {
      result.push(angle);
    }
  }

  return result.slice(0, count);
}

function _assignVisualAngles(selectedAngles, variantCount) {
  const result = [];
  const mapping = {
    pain_based:    'problem_scene',
    desire_based:  'before_after',
    fear_based:    'problem_scene',
    status_based:  'testimonial',
    logic_based:   'demo',
  };

  for (let i = 0; i < (variantCount || 1); i++) {
    const angle       = selectedAngles[i]?.type || 'pain_based';
    const visualType  = mapping[angle] || VISUAL_ANGLE_TYPES[i % VISUAL_ANGLE_TYPES.length];
    result.push({ variantIndex: i, angleType: angle, visualType });
  }

  return result;
}

function getAngleInstructions(angleType) {
  const profile = ANGLE_TYPES[angleType];
  if (!profile) return '';
  return [
    `זווית: ${profile.label} — ${profile.description}`,
    `מנגנון שכנוע: ${profile.mechanism}`,
    `תבנית פתיחה: "${profile.hookPattern}"`,
    `דוגמה: "${profile.example}"`,
  ].join('\n');
}

module.exports = {
  buildAngleTesting,
  getAngleInstructions,
  ANGLE_TYPES,
  VISUAL_ANGLE_TYPES,
};
