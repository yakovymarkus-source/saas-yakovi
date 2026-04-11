'use strict';

/**
 * validators/html-validator.js — Structural HTML Quality Validator
 *
 * Validates the HTML string output of composeHTML() for structural,
 * accessibility, RTL, mobile, and conversion correctness.
 *
 * Does NOT require external dependencies — regex + string ops only.
 *
 * Scoring (same scale as anti-generic-validator):
 *   < 20  → valid: true,  clean pass
 *   20–39 → valid: true,  flagged
 *   ≥ 40  → valid: false, blocked
 *
 * Usage:
 *   const { validateHTML } = require('./validators/html-validator');
 *   const result = validateHTML(html, { assetType: 'landing_page_html' });
 *   if (!result.valid) { ... }
 */

// ── Severity weights (mirrored from anti-generic-validator) ──────────────────

const W = {
  critical: 20,
  major:    10,
  minor:     5,
  warning:   2,
};

// ── Tag balance checker ───────────────────────────────────────────────────────
// Checks that every opened block-level tag has a matching close tag.
// Intentionally lightweight — handles most real-world issues without a full DOM.

const VOID_TAGS = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);

const OPEN_TAG_RE  = /<([a-z][a-z0-9-]*)(?:\s[^>]*)?\s*(?!\/)>/gi;
const CLOSE_TAG_RE = /<\/([a-z][a-z0-9-]*)>/gi;

function checkTagBalance(html) {
  const opens  = {};
  const closes = {};

  let m;
  const openRe = new RegExp(OPEN_TAG_RE.source, 'gi');
  while ((m = openRe.exec(html)) !== null) {
    const tag = m[1].toLowerCase();
    if (!VOID_TAGS.has(tag)) opens[tag] = (opens[tag] || 0) + 1;
  }

  const closeRe = new RegExp(CLOSE_TAG_RE.source, 'gi');
  while ((m = closeRe.exec(html)) !== null) {
    const tag = m[1].toLowerCase();
    closes[tag] = (closes[tag] || 0) + 1;
  }

  const unmatched = [];
  const CRITICAL_TAGS = ['html', 'head', 'body', 'div', 'section', 'form', 'nav', 'main', 'header', 'footer'];
  for (const tag of CRITICAL_TAGS) {
    const o = opens[tag]  || 0;
    const c = closes[tag] || 0;
    if (o !== c) unmatched.push({ tag, opens: o, closes: c });
  }
  return unmatched;
}

// ── CTA detection ─────────────────────────────────────────────────────────────
// A page must have at least one call-to-action: a <button>, a <a href> that
// looks like an action, or an <input type="submit">.

const CTA_PATTERNS = [
  /<button[^>]*>/i,
  /<input[^>]+type=["']submit["'][^>]*>/i,
  /<a[^>]+class=["'][^"']*btn[^"']*["'][^>]*>/i,   // <a class="btn ...">
  /data-cta="true"/i,
];

function hasCTA(html) {
  return CTA_PATTERNS.some(re => re.test(html));
}

// ── RTL checks ────────────────────────────────────────────────────────────────

function checkRTL(html) {
  const issues = [];

  if (!/<html[^>]+dir=["']rtl["']/i.test(html)) {
    issues.push('missing_dir_rtl_on_html');
  }

  if (!/<html[^>]+lang=["']he["']/i.test(html)) {
    issues.push('missing_lang_he');
  }

  // text-align: left is a red flag in RTL pages (unless inside ltr context)
  // Count occurrences — a few is fine (numbers, code), many is a problem
  const leftAlignCount = (html.match(/text-align\s*:\s*left/gi) || []).length;
  if (leftAlignCount > 3) {
    issues.push(`text_align_left_${leftAlignCount}_times`);
  }

  // direction: ltr without a wrapping element is a red flag
  const ltrCount = (html.match(/direction\s*:\s*ltr/gi) || []).length;
  if (ltrCount > 2) {
    issues.push(`direction_ltr_${ltrCount}_times`);
  }

  return issues;
}

// ── Mobile checks ─────────────────────────────────────────────────────────────

function checkMobile(html) {
  const issues = [];

  if (!/<meta[^>]+name=["']viewport["']/i.test(html)) {
    issues.push('missing_viewport_meta');
  }

  if (!/@media[^{]+max-width/i.test(html)) {
    issues.push('no_responsive_media_queries');
  }

  // Fixed widths wider than 480px in body/container are risky on mobile
  const wideFixedWidth = /width\s*:\s*([5-9]\d{2,}|[1-9]\d{3,})px/gi;
  const wideMatches = (html.match(wideFixedWidth) || []);
  if (wideMatches.length > 3) {
    issues.push(`${wideMatches.length}_fixed_wide_widths`);
  }

  // font-size in px smaller than 13px
  const tinyFontRe = /font-size\s*:\s*(([1-9]|1[0-2])px)/gi;
  const tinyFonts = (html.match(tinyFontRe) || []);
  if (tinyFonts.length > 0) {
    issues.push(`${tinyFonts.length}_tiny_font_sizes`);
  }

  return issues;
}

// ── Layout hierarchy checks ───────────────────────────────────────────────────

function checkHierarchy(html, assetType) {
  const issues = [];

  // Landing pages must have an <h1>
  if (assetType === 'landing_page_html' || assetType === 'landing_hero') {
    if (!/<h1[\s>]/i.test(html)) {
      issues.push('missing_h1');
    }
    // Multiple <h1> is an SEO problem
    const h1Count = (html.match(/<h1[\s>]/gi) || []).length;
    if (h1Count > 1) {
      issues.push(`multiple_h1_${h1Count}`);
    }
  }

  // Must have at least one <section> or meaningful block
  if (!/<section[\s>]/i.test(html)) {
    issues.push('no_sections');
  }

  // No empty anchor tags
  const emptyAnchors = (html.match(/<a[^>]+href=["']#["'][^>]*>/gi) || []).length;
  if (emptyAnchors > 2) {
    issues.push(`${emptyAnchors}_empty_anchor_hrefs`);
  }

  return issues;
}

// ── Document structure checks ─────────────────────────────────────────────────

function checkDocumentStructure(html) {
  const issues = [];

  if (!html.trim().startsWith('<!DOCTYPE')) {
    issues.push('missing_doctype');
  }

  if (!/<meta[^>]+charset/i.test(html)) {
    issues.push('missing_charset_meta');
  }

  if (!/<title[^>]*>[^<]+<\/title>/i.test(html)) {
    issues.push('missing_or_empty_title');
  }

  if (!/<style[^>]*>[\s\S]+<\/style>/i.test(html) &&
      !/<link[^>]+rel=["']stylesheet["']/i.test(html)) {
    issues.push('no_styles');
  }

  return issues;
}

// ── Form checks (Netlify forms) ───────────────────────────────────────────────

function checkForms(html) {
  const issues = [];
  const hasForms = /<form[\s>]/i.test(html);
  if (!hasForms) return issues;

  if (!/<form[^>]+data-netlify=["']true["']/i.test(html)) {
    issues.push('form_missing_data_netlify');
  }

  // Every form should have a submit button or input[type=submit]
  const formCount = (html.match(/<form[\s>]/gi) || []).length;
  const submitCount = (html.match(/<(button|input)[^>]+(type=["']submit["']|type=["']button["'])[^>]*>/gi) || []).length
                    + (html.match(/<button(?!\s+type)[^>]*>/gi) || []).length; // button without type defaults to submit

  if (submitCount < formCount) {
    issues.push('form_missing_submit_button');
  }

  return issues;
}

// ── Size check ────────────────────────────────────────────────────────────────

const MAX_HTML_WARN_BYTES  = 500_000;  // 500 KB — warn
const MAX_HTML_BLOCK_BYTES = 2_000_000; // 2 MB — block

// ─────────────────────────────────────────────────────────────────────────────
// validateHTML — main entry
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {string} html      — output of composeHTML().html
 * @param {object} options
 *   assetType {string}  — 'landing_page_html' | 'banner_html' | 'ad_html' | 'landing_hero'
 * @returns {ValidationResult}
 *   valid    {boolean}
 *   pass     {boolean}
 *   score    {number}
 *   issues   {Issue[]}
 *   summary  {object}
 */
function validateHTML(html, { assetType = 'landing_page_html' } = {}) {
  const issues = [];

  function addIssue(code, message, level) {
    issues.push({ code, message, severity: level, weight: W[level] });
  }

  // ── 0. Guard ──────────────────────────────────────────────────────────────
  if (typeof html !== 'string' || html.length === 0) {
    addIssue('EMPTY_HTML', 'HTML ריק — לא הורכב תוכן.', 'critical');
    return { valid: false, pass: false, score: W.critical, issues, summary: { critical: 1, major: 0, minor: 0, warning: 0 } };
  }

  // ── 1. Size ───────────────────────────────────────────────────────────────
  const sizeBytes = Buffer.byteLength(html, 'utf8');
  if (sizeBytes > MAX_HTML_BLOCK_BYTES) {
    addIssue('HTML_TOO_LARGE', `HTML גדול מדי: ${Math.round(sizeBytes / 1024)}KB — יעלה לאט מאוד.`, 'critical');
  } else if (sizeBytes > MAX_HTML_WARN_BYTES) {
    addIssue('HTML_LARGE', `HTML כבד: ${Math.round(sizeBytes / 1024)}KB — שקול לבצע אופטימיזציה.`, 'warning');
  }

  // ── 2. Document structure ─────────────────────────────────────────────────
  for (const issue of checkDocumentStructure(html)) {
    const messages = {
      missing_doctype:        'חסר <!DOCTYPE html> — דפדפנים ירנדרו במצב quirks.',
      missing_charset_meta:   'חסרה הגדרת charset — עלולות להיות בעיות בעברית.',
      missing_or_empty_title: 'חסר <title> — SEO ו-UX יינזקו.',
      no_styles:              'לא נמצאו סגנונות CSS — הדף ירנדר ללא עיצוב.',
    };
    const level = (issue === 'missing_doctype' || issue === 'no_styles') ? 'major' : 'minor';
    addIssue(`DOC_${issue.toUpperCase()}`, messages[issue] || issue, level);
  }

  // ── 3. Tag balance ────────────────────────────────────────────────────────
  const unmatched = checkTagBalance(html);
  if (unmatched.length > 0) {
    const detail = unmatched.map(u => `<${u.tag}> (פתוח: ${u.opens}, סגור: ${u.closes})`).join(', ');
    const level = unmatched.some(u => ['html','body','div','section'].includes(u.tag)) ? 'critical' : 'major';
    addIssue('UNBALANCED_TAGS', `תגיות HTML לא מאוזנות: ${detail}`, level);
  }

  // ── 4. CTA ────────────────────────────────────────────────────────────────
  // Banners don't always need a CTA button in the HTML — they're images with links
  if (assetType !== 'banner_html' && !hasCTA(html)) {
    addIssue('MISSING_CTA', 'אין כפתור CTA — הדף לא יניב המרות.', 'critical');
  }

  // ── 5. RTL ────────────────────────────────────────────────────────────────
  for (const issue of checkRTL(html)) {
    const messages = {
      missing_dir_rtl_on_html:         'חסר dir="rtl" על תג <html> — הדף ירנדר LTR.',
      missing_lang_he:                 'חסר lang="he" על תג <html> — בעיית accessibility ו-SEO.',
      [`text_align_left_${(html.match(/text-align\s*:\s*left/gi)||[]).length}_times`]:
        `יישור text-align: left מרובה — בדוק עימוד RTL.`,
    };
    const level = issue.startsWith('missing_dir') ? 'major' : 'minor';
    const msg = Object.entries(messages).find(([k]) => issue.startsWith(k.split('_')[0] + '_' + k.split('_')[1]))?.[1] || issue;
    addIssue(`RTL_${issue.toUpperCase()}`, messages[issue] || msg, level);
  }

  // ── 6. Mobile ─────────────────────────────────────────────────────────────
  for (const issue of checkMobile(html)) {
    const messages = {
      missing_viewport_meta:          'חסר viewport meta tag — הדף לא יהיה mobile-friendly.',
      no_responsive_media_queries:    'אין media queries responsive — לא יתאים למובייל.',
    };
    const level = issue.startsWith('missing_viewport') ? 'major'
                : issue.startsWith('no_responsive')    ? 'major' : 'minor';
    addIssue(`MOBILE_${issue.toUpperCase()}`, messages[issue] || issue, level);
  }

  // ── 7. Layout hierarchy ───────────────────────────────────────────────────
  for (const issue of checkHierarchy(html, assetType)) {
    const messages = {
      missing_h1:    'חסר <h1> — SEO נפגע ויעילות הדף יורדת.',
      no_sections:   'אין <section> elements — מבנה הדף שטוח מדי.',
    };
    const level = issue === 'missing_h1' ? 'major' : 'minor';
    addIssue(`HIERARCHY_${issue.toUpperCase()}`, messages[issue] || issue, level);
  }

  // ── 8. Form quality ───────────────────────────────────────────────────────
  for (const issue of checkForms(html)) {
    const messages = {
      form_missing_data_netlify:    'טופס ללא data-netlify="true" — לא יעבוד ב-Netlify.',
      form_missing_submit_button:   'טופס ללא כפתור שליחה.',
    };
    addIssue(`FORM_${issue.toUpperCase()}`, messages[issue] || issue, 'major');
  }

  // ── 9. Image alt attributes ───────────────────────────────────────────────
  const imgNoAlt = (html.match(/<img(?![^>]*\balt=)[^>]*>/gi) || []).length;
  if (imgNoAlt > 0) {
    addIssue('IMG_MISSING_ALT',
      `${imgNoAlt} תמונות ללא alt — בעיית accessibility.`,
      imgNoAlt > 3 ? 'major' : 'minor');
  }

  // ── 10. Inline script injection (security signal) ─────────────────────────
  const inlineScripts = (html.match(/<script(?![^>]+src=)[^>]*>[\s\S]*?<\/script>/gi) || []).length;
  if (inlineScripts > 0) {
    addIssue('INLINE_SCRIPTS',
      `${inlineScripts} inline <script> blocks — עלול להיחסם על ידי CSP.`,
      'warning');
  }

  // ── Score and verdict ──────────────────────────────────────────────────────
  const score = issues.reduce((sum, i) => sum + i.weight, 0);
  const valid = score < 40;

  return {
    valid,
    pass: valid,
    score,
    issues,
    summary: {
      critical: issues.filter(i => i.severity === 'critical').length,
      major:    issues.filter(i => i.severity === 'major').length,
      minor:    issues.filter(i => i.severity === 'minor').length,
      warning:  issues.filter(i => i.severity === 'warning').length,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
module.exports = { validateHTML };
