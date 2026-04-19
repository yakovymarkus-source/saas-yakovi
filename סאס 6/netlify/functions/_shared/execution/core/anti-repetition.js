'use strict';
/**
 * execution/core/anti-repetition.js
 * Detects repeated hooks, structures, and CTAs within and across assets.
 * Generates variation instructions to prevent repetition.
 */

const HOOK_OPENING_PATTERNS = [
  /^(האם|שאלה|מה אם|תאר לך|דמיין|כולם יודעים)/i,
  /^(הבעיה|הסוד|הסיבה|האמת|החדשות)/i,
  /^(\d+\s*(דרכים|טיפים|שלבים|סיבות|טעויות))/i,
  /^(אני|אנחנו|אתה)/i,
  /^(זה|הנה|לגלות|לדעת)/i,
];

function buildAntiRepetitionGuard(existingAssets) {
  const usedHookPatterns  = new Set();
  const usedCtaTexts      = new Set();
  const usedOpeningStyles = new Set();
  const usedStructures    = new Set();

  for (const asset of (existingAssets || [])) {
    _indexAsset(asset, { usedHookPatterns, usedCtaTexts, usedOpeningStyles, usedStructures });
  }

  return {
    usedHookPatterns:  [...usedHookPatterns],
    usedCtaTexts:      [...usedCtaTexts],
    usedOpeningStyles: [...usedOpeningStyles],
    usedStructures:    [...usedStructures],
    checkHook:    (text) => _checkRepetition(text, usedHookPatterns, 'hook'),
    checkCta:     (text) => _checkRepetition(text, usedCtaTexts, 'cta'),
    getInstructions: () => _buildVariationInstructions({ usedHookPatterns, usedCtaTexts, usedOpeningStyles, usedStructures }),
  };
}

function checkWithinBatch(generatedAssets) {
  const issues = [];
  const seen   = new Map();

  for (let i = 0; i < generatedAssets.length; i++) {
    const asset = generatedAssets[i];
    const hook  = _extractHookText(asset);
    const cta   = _extractCtaText(asset);
    const style = _classifyOpeningStyle(hook);

    if (seen.has(style) && style !== 'unknown') {
      issues.push({
        type:     'duplicate_opening_style',
        assetA:   seen.get(style),
        assetB:   i,
        style,
        message:  `וריאנטים ${seen.get(style)} ו-${i} משתמשים באותו סגנון פתיחה (${style})`,
      });
    } else {
      seen.set(style, i);
    }

    if (cta && seen.has(`cta:${cta}`) && cta.length > 5) {
      issues.push({
        type:    'duplicate_cta',
        assetA:  seen.get(`cta:${cta}`),
        assetB:  i,
        cta,
        message: `וריאנטים ${seen.get(`cta:${cta}`)} ו-${i} משתמשים באותו CTA ("${cta}")`,
      });
    } else if (cta) {
      seen.set(`cta:${cta}`, i);
    }
  }

  return { issues, clean: issues.length === 0 };
}

function buildVariationInstructions(variantIndex, variantStrategy, usedPatterns) {
  const themes = variantStrategy || [];
  const theme  = themes[variantIndex] || {};
  const used   = usedPatterns || [];

  const avoidList = used.length > 0
    ? `אל תשתמש בסגנונות פתיחה הבאים (כבר בשימוש): ${used.join(', ')}`
    : '';

  const OPENING_BY_METHOD = {
    emotional_story:  'פתח עם סיפור אישי קצר (1-2 משפטים)',
    direct_response:  'פתח עם שאלה ישירה על הכאב',
    social_proof:     'פתח עם תוצאה של לקוח',
    educational:      'פתח עם עובדה מפתיעה או סטטיסטיקה',
    authority:        'פתח עם הצהרה תקיפה וסמכותית',
    contrast:         'פתח עם "רוב האנשים..." ואז ניגוד',
  };

  const opening = OPENING_BY_METHOD[theme.method] || 'פתח בסגנון שונה מהווריאנטים הקודמים';

  return {
    variantIndex,
    theme:        theme.label || `וריאנט ${variantIndex + 1}`,
    toneInstruction: theme.tone ? `השתמש בטון: ${theme.tone}` : '',
    methodInstruction: theme.method ? `שיטה: ${theme.method}` : '',
    openingInstruction: opening,
    avoidInstruction: avoidList,
    differentiatorNote: `וריאנט זה צריך להיות שונה מהוריאנטים הקודמים בגישה ובסגנון`,
  };
}

// ── Internal ──────────────────────────────────────────────────────────────────

function _indexAsset(asset, store) {
  const hook  = _extractHookText(asset);
  const cta   = _extractCtaText(asset);
  const style = _classifyOpeningStyle(hook);
  const struct = asset.structure || asset.type || '';

  if (style !== 'unknown') store.usedOpeningStyles.add(style);
  if (cta)   store.usedCtaTexts.add(cta.slice(0, 20));
  if (struct) store.usedStructures.add(struct);

  for (const pat of HOOK_OPENING_PATTERNS) {
    if (hook && pat.test(hook)) {
      store.usedHookPatterns.add(pat.source);
      break;
    }
  }
}

function _checkRepetition(text, usedSet, type) {
  if (!text) return { repeated: false };
  const key = text.slice(0, 20).toLowerCase();
  if (usedSet.has(key)) return { repeated: true, type, text };
  usedSet.add(key);
  return { repeated: false };
}

function _buildVariationInstructions({ usedHookPatterns, usedCtaTexts, usedOpeningStyles }) {
  const instructions = [];
  if (usedOpeningStyles.size > 0) {
    instructions.push(`אל תפתח ב: ${[...usedOpeningStyles].join(', ')}`);
  }
  if (usedCtaTexts.size > 0) {
    instructions.push(`CTA שונה מ: ${[...usedCtaTexts].join(' / ')}`);
  }
  return instructions;
}

function _extractHookText(asset) {
  return asset?.hook || asset?.headline || asset?.opening || asset?.content?.slice?.(0, 100) || '';
}

function _extractCtaText(asset) {
  return asset?.cta || asset?.cta_text || asset?.call_to_action || '';
}

function _classifyOpeningStyle(text) {
  if (!text) return 'unknown';
  const t = text.toLowerCase();
  if (/^(האם|שאלה)/.test(t)) return 'question';
  if (/^(הבעיה|הסוד|האמת)/.test(t)) return 'reveal';
  if (/^\d+\s*(דרכים|טיפים|שלבים)/.test(t)) return 'list';
  if (/^(אני|הלקוח|הסיפור)/.test(t)) return 'story';
  if (/^(זה|הנה)/.test(t)) return 'direct';
  if (/^(דמיין|תאר לך)/.test(t)) return 'visualization';
  return 'unknown';
}

module.exports = { buildAntiRepetitionGuard, checkWithinBatch, buildVariationInstructions };
