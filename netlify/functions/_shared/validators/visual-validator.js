'use strict';

/**
 * validators/visual-validator.js — Visual Clarity & Effectiveness Validator
 *
 * Analyses the HTML output and/or blueprint for visual effectiveness
 * WITHOUT rendering the page. Uses CSS value inspection, DOM structure
 * analysis, and component-order heuristics.
 *
 * Outputs two independent scores (0–100) + an issues list:
 *
 *   clarity_score   — Can a visitor understand the offer in ~2 seconds?
 *                     Driven by: hero structure, headline brevity, CTA placement,
 *                     above-the-fold content, value proposition presence.
 *
 *   hierarchy_score — Is there a clear visual reading order?
 *                     Driven by: heading cascade, font-size range, color
 *                     diversity, section count, CTA count, competing elements.
 *
 * Usage:
 *   const { validateVisual } = require('./validators/visual-validator');
 *   const result = validateVisual({ blueprint, html, assetType });
 *
 * Output shape:
 *   {
 *     clarity_score:   number,   // 0–100
 *     hierarchy_score: number,   // 0–100
 *     combined_score:  number,   // weighted average
 *     grade:           string,   // 'A' | 'B' | 'C' | 'D' | 'F'
 *     issues:          Issue[],  // { code, message, severity, affects }
 *     summary:         object,
 *   }
 */

// ─────────────────────────────────────────────────────────────────────────────
// Penalty definitions
// Each entry: [ points_deducted, affects_score ]
// affects: 'clarity' | 'hierarchy' | 'both'
// ─────────────────────────────────────────────────────────────────────────────

const PENALTIES = {
  // Clarity penalties
  NO_H1_IN_HERO:          { points: 25, affects: 'clarity' },
  HERO_HEADLINE_TOO_LONG: { points: 10, affects: 'clarity' },
  NO_CTA_ABOVE_FOLD:      { points: 25, affects: 'clarity' },
  HERO_BODY_TOO_LONG:     { points: 10, affects: 'clarity' },
  CTA_BURIED:             { points: 15, affects: 'clarity' },
  NO_VALUE_PROP:          { points: 15, affects: 'clarity' },
  COMPETING_PRIMARY_ACTIONS: { points: 10, affects: 'clarity' },

  // Hierarchy penalties
  HEADING_LEVELS_SKIPPED: { points: 20, affects: 'hierarchy' },
  NO_H2_IN_BODY:          { points: 10, affects: 'hierarchy' },
  TOO_MANY_SECTIONS:      { points: 10, affects: 'hierarchy' },
  TOO_MANY_CTAS:          { points: 15, affects: 'hierarchy' },
  TOO_MANY_BG_COLORS:     { points: 10, affects: 'hierarchy' },
  NARROW_FONT_RANGE:      { points: 15, affects: 'hierarchy' },
  NO_SECTION_BREAKS:      { points: 10, affects: 'hierarchy' },

  // Both
  MISSING_HERO:           { points: 30, affects: 'both' },
  NO_CSS_CONTRAST:        { points: 15, affects: 'both' },
};

// ── Word counting ─────────────────────────────────────────────────────────────

function wordCount(str) {
  return (str || '').trim().split(/\s+/).filter(Boolean).length;
}

// ── Strip HTML tags to plain text ─────────────────────────────────────────────

function stripTags(html) {
  return (html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// ── Extract all px font-size values from CSS ──────────────────────────────────

function extractFontSizesPx(css) {
  const sizes = new Set();
  const re = /font-size\s*:\s*(\d+(?:\.\d+)?)(px|rem|em)/gi;
  let m;
  while ((m = re.exec(css)) !== null) {
    const val = parseFloat(m[1]);
    // Normalise rem/em roughly to px (assuming 16px base)
    const px = m[2].toLowerCase() === 'px' ? val : val * 16;
    if (px >= 10 && px <= 120) sizes.add(Math.round(px));
  }
  return [...sizes].sort((a, b) => a - b);
}

// ── Extract background-color values from CSS ──────────────────────────────────

function extractBgColors(css) {
  const colors = new Set();
  const re = /background(?:-color)?\s*:\s*(#[0-9a-f]{3,8}|rgba?\([^)]+\)|[a-z]+)/gi;
  let m;
  while ((m = re.exec(css)) !== null) {
    const c = m[1].toLowerCase();
    // Skip transparent / inherit / initial / common non-colors
    if (!['transparent', 'inherit', 'initial', 'none', 'unset', 'currentcolor'].includes(c)) {
      colors.add(c);
    }
  }
  return [...colors];
}

// ── Count heading levels present in HTML ─────────────────────────────────────

function headingLevelsPresent(html) {
  const levels = [];
  for (let i = 1; i <= 6; i++) {
    if (new RegExp(`<h${i}[\\s>]`, 'i').test(html)) levels.push(i);
  }
  return levels;
}

// ── Detect heading level skip (e.g. H1 → H3, skipping H2) ───────────────────

function hasHeadingSkip(levels) {
  for (let i = 0; i < levels.length - 1; i++) {
    if (levels[i + 1] - levels[i] > 1) return true;
  }
  return false;
}

// ── CTA button count ──────────────────────────────────────────────────────────

function countCTAButtons(html) {
  const buttons = (html.match(/<button[^>]*>/gi) || []).length;
  const submits = (html.match(/<input[^>]+type=["']submit["'][^>]*>/gi) || []).length;
  const btnLinks = (html.match(/<a[^>]+class=["'][^"']*btn[^"']*["'][^>]*>/gi) || []).length;
  return buttons + submits + btnLinks;
}

// ── Estimate content position of first CTA (0.0 – 1.0) ──────────────────────
// Approximates "how far down the page" the first CTA appears.

function firstCTAPosition(html) {
  const firstBtn = html.search(/<button[^>]*>|<input[^>]+type=["']submit["']|<a[^>]+class=["'][^"']*btn[^"']*["']/i);
  if (firstBtn === -1) return 1.0;
  return firstBtn / html.length;
}

// ── Section count ─────────────────────────────────────────────────────────────

function countSections(html) {
  return (html.match(/<section[\s>]/gi) || []).length;
}

// ─────────────────────────────────────────────────────────────────────────────
// Blueprint-based hero analysis (more precise than HTML scraping)
// ─────────────────────────────────────────────────────────────────────────────

function analyseHeroFromBlueprint(blueprint) {
  if (!blueprint?.components?.length) return null;

  // Hero is always first component
  const hero = blueprint.components[0];
  if (!hero || hero.type !== 'hero') return null;

  const props = hero.props || {};
  return {
    hasHeadline:      !!props.headline,
    headlineWords:    wordCount(props.headline || ''),
    hasSubtitle:      !!props.subtitle,
    subtitleWords:    wordCount(props.subtitle || ''),
    hasCTA:           !!(props.cta_primary?.text || props.cta_text),
    hasValueProp:     !!(props.subtitle || props.body || props.value_prop),
    bodyWords:        wordCount(props.body || props.subtitle || ''),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// validateVisual — main entry
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {object} params
 *   blueprint  {object?} — output of buildHTMLBlueprint()
 *   html       {string?} — output of composeHTML().html
 *   assetType  {string}  — 'landing_page_html' | 'banner_html' | 'ad_html' | 'landing_hero'
 * @returns {VisualValidationResult}
 */
function validateVisual({ blueprint = null, html = '', assetType = 'landing_page_html' } = {}) {
  const issues = [];
  let clarityPenalty   = 0;
  let hierarchyPenalty = 0;

  function penalise(key, message, severity = 'major') {
    const p = PENALTIES[key];
    if (!p) return;
    if (p.affects === 'clarity'   || p.affects === 'both') clarityPenalty   += p.points;
    if (p.affects === 'hierarchy' || p.affects === 'both') hierarchyPenalty += p.points;
    issues.push({ code: key, message, severity, affects: p.affects });
  }

  const isBannerOrAd = assetType === 'banner_html' || assetType === 'ad_html';

  // ── Extract CSS from <style> block for analysis ─────────────────────────────
  const cssMatch = /<style[^>]*>([\s\S]*?)<\/style>/i.exec(html);
  const css = cssMatch ? cssMatch[1] : '';

  // ── 1. Hero presence ────────────────────────────────────────────────────────
  const heroInBlueprint = blueprint?.components?.[0]?.type === 'hero';
  const heroInHtml = /<section[^>]*data-component=["']hero["']/i.test(html);

  if (!isBannerOrAd && !heroInBlueprint && !heroInHtml) {
    penalise('MISSING_HERO', 'אין Hero section — המבקר לא מבין מה הדף מציע תוך 2 שניות.', 'critical');
  }

  // ── 2. Two-second clarity: Hero content analysis ────────────────────────────
  const heroData = analyseHeroFromBlueprint(blueprint);

  if (heroData) {
    // H1 presence
    if (!heroData.hasHeadline) {
      penalise('NO_H1_IN_HERO', 'Hero ללא כותרת ראשית — אין מסר עיקרי ברור.', 'critical');
    }

    // Headline brevity (ideal: 5–12 words; >15 is too long)
    if (heroData.headlineWords > 15) {
      penalise('HERO_HEADLINE_TOO_LONG',
        `כותרת ה-Hero ארוכה מדי (${heroData.headlineWords} מילים) — קצר ל-12 מילים לכל היותר.`, 'major');
    }

    // CTA in hero
    if (!heroData.hasCTA) {
      penalise('NO_CTA_ABOVE_FOLD', 'אין CTA ב-Hero — המבקר לא יודע מה לעשות עם המידע.', 'critical');
    }

    // Body text length above the fold (>50 words competes with headline for attention)
    if (heroData.bodyWords > 50) {
      penalise('HERO_BODY_TOO_LONG',
        `טקסט ה-Hero ארוך מדי (${heroData.bodyWords} מילים) — קצר ל-50 מילים לפני ה-CTA.`, 'minor');
    }

    // Value proposition signal
    if (!heroData.hasValueProp) {
      penalise('NO_VALUE_PROP', 'Hero חסר הצעת ערך — מה הלקוח מרוויח?', 'major');
    }

  } else if (!isBannerOrAd) {
    // Fallback: check from HTML
    if (!/<h1[\s>]/i.test(html)) {
      penalise('NO_H1_IN_HERO', 'חסר <h1> — אין מסר ראשי ברור.', 'critical');
    }
  }

  // ── 3. CTA placement (should appear before 40% of content) ─────────────────
  if (html && !isBannerOrAd) {
    const ctaPos = firstCTAPosition(html);
    if (ctaPos > 0.65) {
      penalise('CTA_BURIED',
        `ה-CTA הראשון מופיע בחלק התחתון של הדף (${Math.round(ctaPos * 100)}%) — העבר אותו גבוה יותר.`, 'major');
    }
  }

  // ── 4. Competing primary actions ───────────────────────────────────────────
  if (html) {
    const ctaCount = countCTAButtons(html);
    if (ctaCount > 5) {
      penalise('COMPETING_PRIMARY_ACTIONS',
        `${ctaCount} כפתורי CTA — יותר מדי אפשרויות גורמות לשיתוק בחירה.`, 'major');
    }
    // Separate hierarchy issue for too many CTAs at a lower threshold
    if (ctaCount > 3) {
      penalise('TOO_MANY_CTAS',
        `${ctaCount} כפתורי פעולה — מקשה על ההיררכיה הויזואלית. עדיף CTA ראשי + 1-2 משניים.`, 'minor');
    }
  }

  // ── 5. Visual hierarchy: heading cascade ───────────────────────────────────
  if (html && !isBannerOrAd) {
    const levels = headingLevelsPresent(html);

    if (levels.length > 1 && hasHeadingSkip(levels)) {
      penalise('HEADING_LEVELS_SKIPPED',
        `רמות כותרת מדולגות (${levels.join(' → ')}) — גורם לבלבול בסריקה הויזואלית.`, 'major');
    }

    if (levels.length > 0 && !levels.includes(2)) {
      penalise('NO_H2_IN_BODY',
        'אין כותרות H2 בגוף הדף — המבנה שטוח, קשה לסרוק.', 'minor');
    }
  }

  // ── 6. Section count (overload) ────────────────────────────────────────────
  if (html && !isBannerOrAd) {
    const secCount = countSections(html);
    if (secCount > 10) {
      penalise('TOO_MANY_SECTIONS',
        `${secCount} סקשנים — עומס מידע. שקול לקצר לנרטיב ממוקד (5-8 סקשנים).`, 'minor');
    }
    if (secCount === 0) {
      penalise('NO_SECTION_BREAKS',
        'הדף לא מחולק לסקשנים — קשה לסרוק ולא מוביל עין.', 'major');
    }
  }

  // ── 7. CSS: font-size range ────────────────────────────────────────────────
  if (css) {
    const fontSizes = extractFontSizesPx(css);
    const sizeRange = fontSizes.length > 0
      ? fontSizes[fontSizes.length - 1] - fontSizes[0]
      : 0;

    if (fontSizes.length > 0 && sizeRange < 12) {
      penalise('NARROW_FONT_RANGE',
        `טווח גודל טקסט צר מדי (${fontSizes[0]}px–${fontSizes[fontSizes.length - 1]}px) — חוסר היררכיה טיפוגרפית.`,
        'minor');
    }
  }

  // ── 8. CSS: background color diversity ────────────────────────────────────
  if (css) {
    const bgColors = extractBgColors(css);
    if (bgColors.length > 7) {
      penalise('TOO_MANY_BG_COLORS',
        `${bgColors.length} צבעי רקע שונים — יוצר רעש ויזואלי. עדיף פלטה של 2-4 צבעים.`,
        'minor');
    }
  }

  // ── 9. Contrast signal (basic — not a full WCAG check) ────────────────────
  // Detect common low-contrast patterns: light text on light bg, dark on dark
  if (css) {
    const lightOnLight = /color\s*:\s*(#[ef][ef][ef][0-9a-f]{0,3}|white|#fff)[^;]*;[^}]*background[^:]*:\s*(#[ef][ef][ef][0-9a-f]{0,3}|white|#fff)/i.test(css);
    const darkOnDark   = /color\s*:\s*(#[01][01][01][0-9a-f]{0,3}|black|#000)[^;]*;[^}]*background[^:]*:\s*(#[01][01][01][0-9a-f]{0,3}|black|#000)/i.test(css);
    if (lightOnLight || darkOnDark) {
      penalise('NO_CSS_CONTRAST',
        'נמצאו שילובי צבעים בעלי קונטרסט נמוך — קשה לקריאה ופוגע בנגישות.',
        'major');
    }
  }

  // ── Scoring ────────────────────────────────────────────────────────────────
  // Cap penalties at 100 (no negative scores)
  const clarity_score   = Math.max(0, 100 - clarityPenalty);
  const hierarchy_score = Math.max(0, 100 - hierarchyPenalty);
  const combined_score  = Math.round(clarity_score * 0.6 + hierarchy_score * 0.4);

  // Letter grade on combined score
  const grade = combined_score >= 90 ? 'A'
              : combined_score >= 75 ? 'B'
              : combined_score >= 60 ? 'C'
              : combined_score >= 45 ? 'D'
              : 'F';

  return {
    clarity_score,
    hierarchy_score,
    combined_score,
    grade,
    issues,
    summary: {
      clarity_penalty:   clarityPenalty,
      hierarchy_penalty: hierarchyPenalty,
      critical: issues.filter(i => i.severity === 'critical').length,
      major:    issues.filter(i => i.severity === 'major').length,
      minor:    issues.filter(i => i.severity === 'minor').length,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
module.exports = { validateVisual };
