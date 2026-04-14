'use strict';

/**
 * validators/anti-generic-validator.js — Anti-Generic Content Validator
 *
 * Inspects blueprint components and/or composed HTML for generic, template-like,
 * or non-specific content before the asset is saved and returned to the user.
 *
 * Works on TWO inputs (either or both):
 *   blueprint     — output of buildHTMLBlueprint()  (pre-HTML, preferred)
 *   composeResult — output of composeHTML()          (post-HTML, supplementary)
 *
 * Scoring:
 *   Each issue carries a weight. Total severity score drives the verdict.
 *   < 20  → valid: true,  clean pass
 *   20–39 → valid: true,  flagged (warnings surfaced to user)
 *   ≥ 40  → valid: false, blocked (caller should regenerate or surface error)
 *
 * Usage:
 *   const { validateGeneric } = require('./validators/anti-generic-validator');
 *   const result = validateGeneric({ blueprint, composeResult, memory });
 *   if (!result.valid) { ... }
 */

// ── Severity weights ──────────────────────────────────────────────────────────

const W = {
  critical: 20,   // structural failure — blocks output
  major:    10,   // clearly visible quality problem
  minor:     5,   // degrades trust / conversion
  warning:   2,   // informational, does not block
};

// ── Generic phrase lists ──────────────────────────────────────────────────────

// Hebrew + English generic placeholder phrases that indicate unresolved templates
const GENERIC_HEADLINES_HE = [
  'הכותרת שלך',
  'כותרת ראשית',
  'הוסף כותרת',
  'טקסט לדוגמה',
  'תוכן לדוגמה',
  'תאר את המוצר',
  'כתוב כאן',
  'placeholder',
  'lorem ipsum',
  'your headline',
  'your title',
  'enter text',
  'add your',
  'insert text',
  'sample text',
];

// Generic CTAs that carry zero differentiation
const GENERIC_CTAS = [
  'לחץ כאן',
  'לחצו כאן',
  'קרא עוד',
  'קראו עוד',
  'לחץ',
  'click here',
  'read more',
  'learn more',
  'submit',
  'שלח',         // just "submit" with no context
  'המשך',        // just "continue" with no context
];

// Signals of real specificity — if absent, content is probably generic
const SPECIFICITY_SIGNALS = [
  /\d+%/,                      // percentage claim  "87% מהלקוחות"
  /\d+\s*(ש"ח|₪|ILS|\$|€|USD)/i, // price anchor
  /\d+\s*(יום|שבוע|חודש|שעה|דקה)/i, // time commitment
  /\b(ייחודי|בלעדי|מוכח|מובטח|מוגבל|בלבד)\b/i, // strong Hebrew differentiators
  /\b(guaranteed|proven|exclusive|limited)\b/i,
  /\b\d{4}\b/,                 // year (social proof signal)
  /\b\d{2,}\s*(לקוח|לקוחות|client|customer)/i, // customer count
];

// ── Content placeholder detection (from html-composer.js cp pattern) ──────────
const CP_PATTERN  = /class="cp"/g;              // <span class="cp"> in HTML
const IMG_SLOT_RE = /data-image-prompt/g;        // injected image slots

// ── Weak differentiation indicators ──────────────────────────────────────────

// These appear in body copy of weak outputs — presence alone isn't fatal but
// combined with low specificity they indicate template-think.
const WEAK_DIFFERENTIATOR_PHRASES = [
  'פתרון מקיף',
  'שירות מקצועי',
  'צוות מנוסה',
  'איכות גבוהה',
  'שירות מצוין',
  'the best',
  'high quality',
  'professional service',
  'experienced team',
  'comprehensive solution',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function lower(s) { return (s || '').toLowerCase(); }

function countOccurrences(text, phrases) {
  return phrases.filter(p => lower(text).includes(lower(p))).length;
}

function hasSpecificitySignal(text) {
  return SPECIFICITY_SIGNALS.some(re => re.test(text));
}

/**
 * Extract all string values recursively from a nested object/array.
 * Used to scan blueprint props without knowing their exact shape.
 */
function extractStrings(obj, acc = []) {
  if (typeof obj === 'string') { acc.push(obj); return acc; }
  if (Array.isArray(obj)) { obj.forEach(v => extractStrings(v, acc)); return acc; }
  if (obj && typeof obj === 'object') { Object.values(obj).forEach(v => extractStrings(v, acc)); return acc; }
  return acc;
}

// ─────────────────────────────────────────────────────────────────────────────
// validateGeneric — main entry
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {object} params
 *   blueprint      {object?} — output of buildHTMLBlueprint()
 *   composeResult  {object?} — output of composeHTML()
 *   memory         {object?} — MarketingMemory (used for context-aware checks)
 * @returns {ValidationResult}
 *   valid    {boolean}
 *   issues   {Issue[]}   — { code, message, severity, weight }
 *   score    {number}    — total severity score
 *   pass     {boolean}   — alias for valid (convenience)
 */
function validateGeneric({ blueprint = null, composeResult = null, memory = null } = {}) {
  const issues = [];

  function addIssue(code, message, level) {
    issues.push({ code, message, severity: level, weight: W[level] });
  }

  // ── 1. Collect all text content for scanning ────────────────────────────────
  const allText = [];

  if (blueprint?.components) {
    for (const component of blueprint.components) {
      allText.push(...extractStrings(component.props || {}));
    }
  }

  const htmlText = composeResult?.html || '';
  // Strip tags for text-level checks
  const htmlStripped = htmlText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (htmlStripped) allText.push(htmlStripped);

  const fullText = allText.join(' ');

  // ── 2. Detect unresolved content placeholders ───────────────────────────────
  if (htmlText) {
    const cpCount = (htmlText.match(CP_PATTERN) || []).length;
    if (cpCount >= 5) {
      addIssue('TOO_MANY_PLACEHOLDERS',
        `${cpCount} שדות תוכן לא מולאו (placeholders) — הדף לא מוכן לפרסום.`,
        'critical');
    } else if (cpCount >= 2) {
      addIssue('SOME_PLACEHOLDERS',
        `${cpCount} שדות placeholder נותרו בדף — נדרש מידע עסקי נוסף.`,
        'major');
    } else if (cpCount === 1) {
      addIssue('ONE_PLACEHOLDER',
        `שדה placeholder אחד נותר — בדוק את תוכן הדף.`,
        'warning');
    }
  }

  // ── 3. Detect generic headline phrases ────────────────────────────────────
  const genericHeadlineCount = countOccurrences(fullText, GENERIC_HEADLINES_HE);
  if (genericHeadlineCount >= 3) {
    addIssue('GENERIC_HEADLINES',
      `נמצאו ${genericHeadlineCount} ביטויי כותרת גנריים — נדרש תוכן ספציפי לעסק.`,
      'major');
  } else if (genericHeadlineCount >= 1) {
    addIssue('GENERIC_HEADLINE',
      `נמצא ביטוי כותרת גנרי: "${GENERIC_HEADLINES_HE.find(p => lower(fullText).includes(lower(p)))}"`,
      'minor');
  }

  // ── 4. Detect generic / weak CTAs ─────────────────────────────────────────
  const genericCtaCount = countOccurrences(fullText, GENERIC_CTAS);
  if (genericCtaCount >= 2) {
    addIssue('GENERIC_CTA',
      `${genericCtaCount} כפתורי CTA גנריים ("לחץ כאן", "קרא עוד") — החלף בפעולה ספציפית.`,
      'major');
  } else if (genericCtaCount === 1) {
    addIssue('WEAK_CTA',
      `CTA גנרי נמצא — עדיף CTA ספציפי לתוצאה ("קבל ייעוץ חינם", "הזמן עכשיו").`,
      'minor');
  }

  // ── 5. Specificity check — does the content contain real signals? ───────────
  if (fullText.length > 200 && !hasSpecificitySignal(fullText)) {
    addIssue('NO_SPECIFICITY',
      `התוכן חסר נתונים ספציפיים (אחוזים, מחירים, זמנים, מספרי לקוחות) — נראה גנרי.`,
      'major');
  }

  // ── 6. Weak differentiator density ────────────────────────────────────────
  const weakCount = countOccurrences(fullText, WEAK_DIFFERENTIATOR_PHRASES);
  if (weakCount >= 3) {
    addIssue('WEAK_DIFFERENTIATION',
      `${weakCount} ביטויי דיפרנציאציה חלשים ("שירות מקצועי", "צוות מנוסה") — נדרש יתרון ייחודי.`,
      'major');
  } else if (weakCount >= 1) {
    addIssue('MILD_WEAK_DIFFERENTIATION',
      `${weakCount} ביטוי דיפרנציאציה חלש — שקול להוסיף ראיות ספציפיות.`,
      'warning');
  }

  // ── 7. Business name not present (when memory provides one) ─────────────────
  const bizName = memory?.business?.name;
  if (bizName && bizName.length > 2 && !fullText.includes(bizName)) {
    addIssue('BUSINESS_NAME_MISSING',
      `שם העסק "${bizName}" לא מופיע בתוכן — הדף לא מותאם לעסק.`,
      'minor');
  }

  // ── 8. Audience targeting signal ─────────────────────────────────────────
  const audienceDesc = memory?.audience?.primary_segment;
  if (!audienceDesc && fullText.length > 300) {
    // No audience data — can't check targeting, but warn if content is very generic
    const genericRatio = (genericHeadlineCount + genericCtaCount + weakCount) / 3;
    if (genericRatio > 1) {
      addIssue('UNTARGETED_CONTENT',
        `אין מידע על קהל יעד ותוכן הדף גנרי — נדרש פרופיל עסק מלא.`,
        'minor');
    }
  }

  // ── 9. Minimum content length ──────────────────────────────────────────────
  if (htmlStripped.length < 150) {
    addIssue('CONTENT_TOO_SHORT',
      `התוכן קצר מדי (${htmlStripped.length} תווים) — הדף לא יניב המרות.`,
      'critical');
  }

  // ── 10. Duplicate text blocks (copy-paste from template) ──────────────────
  if (blueprint?.components) {
    const headlinesSeen = new Set();
    let duplicates = 0;
    for (const c of blueprint.components) {
      const h = lower(c.props?.headline || '');
      if (h.length > 10) {
        if (headlinesSeen.has(h)) duplicates++;
        headlinesSeen.add(h);
      }
    }
    if (duplicates >= 2) {
      addIssue('DUPLICATE_CONTENT',
        `${duplicates} כותרות זהות בסקשנים שונים — תבנית לא הותאמה.`,
        'major');
    }
  }

  // ── Score and verdict ──────────────────────────────────────────────────────
  const score = issues.reduce((sum, i) => sum + i.weight, 0);
  const valid = score < 40;

  return {
    valid,
    pass: valid,
    score,
    issues,
    // Summary counts by severity
    summary: {
      critical: issues.filter(i => i.severity === 'critical').length,
      major:    issues.filter(i => i.severity === 'major').length,
      minor:    issues.filter(i => i.severity === 'minor').length,
      warning:  issues.filter(i => i.severity === 'warning').length,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
module.exports = { validateGeneric };
