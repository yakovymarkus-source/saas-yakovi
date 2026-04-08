'use strict';

/**
 * ad-copy-generator.js — Ad Copy Generation Engine (Layer 26)
 *
 * Pure function. Zero DB calls. Zero side effects.
 *
 * Takes a business profile + current bottleneck and produces 3 copy variants
 * using proven formula frameworks (Problem-Agitate, Result-First, Mechanism).
 *
 * Bottleneck-aware:
 *   CTR issue      → headline-heavy, pattern-interrupt hooks
 *   Conv issue     → CTA + offer clarity focus
 *   ROAS issue     → value framing + ROI language
 *   No bottleneck  → balanced across all 3 frameworks
 *
 * Output per variant:
 *   { variant, framework, hook_type, headline, body, cta, platform_note }
 *
 * Platform: 'meta' | 'google_ads' (character-limit guidance differs)
 */

// ── CTA map by primary goal ────────────────────────────────────────────────────

const CTA_BY_GOAL = {
  leads:        ['השאר פרטים עכשיו', 'קבל פרטים חינם', 'דבר איתנו היום'],
  sales:        ['רכוש עכשיו', 'הזמן היום', 'קנה עכשיו'],
  appointments: ['קבע פגישה חינם', 'דבר עם מומחה', 'קבל ייעוץ עכשיו'],
  awareness:    ['גלה עוד', 'למד עוד', 'היכנס לאתר'],
};

function getCTAs(goal) {
  return CTA_BY_GOAL[goal] || CTA_BY_GOAL.leads;
}

// ── Shorten helper — keeps Hebrew copy under platform limits ──────────────────

function cap(str, max) {
  if (!str) return '';
  return str.length <= max ? str : str.slice(0, max - 1) + '…';
}

// ── Framework builders ─────────────────────────────────────────────────────────

/**
 * Framework A: Problem-Agitate
 * "Still suffering from X? Most [audience] face this. Here's how we fix it."
 * Best for: CTR uplift — pattern interrupt for the exact pain the user feels.
 */
function buildProblemAgitate(bp, platform) {
  const problem  = bp.problem_solved   || 'הבעיה שמעצרת את הצמיחה שלך';
  const audience = bp.target_audience  || 'עסקים';
  const outcome  = bp.desired_outcome  || 'תוצאות ממשיות';
  const mech     = bp.unique_mechanism || bp.offer || 'הפתרון שלנו';
  const ctas     = getCTAs(bp.primary_goal);

  const headline = platform === 'google_ads'
    ? cap(`עדיין ${problem}?`, 30)
    : `😤 עדיין ${problem}?`;

  const body = platform === 'google_ads'
    ? cap(`רוב ${audience} מתמודדים עם ${problem}. ${mech} — ${outcome}.`, 90)
    : `רוב ${audience} מתמודדים עם ${problem}.\n\n${mech} שינה את זה.\n\n✅ התוצאה: ${outcome}`;

  return {
    variant:       'A',
    framework:     'problem_agitate',
    hook_type:     'פתיחת כאב',
    headline,
    body,
    cta:           ctas[0],
    platform_note: platform === 'google_ads' ? 'כותרת עד 30 תווים, תיאור עד 90' : 'הוסף תמונה/וידאו שמראה את הכאב',
  };
}

/**
 * Framework B: Result-First
 * Lead with the transformation/outcome. Skeptics need to see the prize first.
 * Best for: conversion lift — pre-qualifies on desired outcome before asking.
 */
function buildResultFirst(bp, platform) {
  const outcome  = bp.desired_outcome  || 'תוצאות שמשנות את העסק';
  const audience = bp.target_audience  || 'עסקים';
  const mech     = bp.unique_mechanism || bp.offer || 'הדרך שלנו';
  const promise  = bp.main_promise     || bp.offer || 'מה שמחכה לך';
  const ctas     = getCTAs(bp.primary_goal);

  const headline = platform === 'google_ads'
    ? cap(outcome, 30)
    : `🏆 ${outcome}`;

  const body = platform === 'google_ads'
    ? cap(`${promise}. ${mech} עוזר ל${audience} להגיע לשם מהר יותר.`, 90)
    : `${promise}\n\nאם אתה ${audience} שרוצה ${outcome}:\n\n👉 ${mech}`;

  return {
    variant:       'B',
    framework:     'result_first',
    hook_type:     'תוצאה ראשונה',
    headline,
    body,
    cta:           ctas[1] || ctas[0],
    platform_note: platform === 'google_ads' ? 'כותרת = המרה הרצויה. תיאור = מנגנון + קהל.' : 'תמונה: לפני/אחרי, או גרף תוצאות',
  };
}

/**
 * Framework C: Mechanism / Unique How
 * "Here's the specific method that makes us different."
 * Best for: differentiation — works when audience is aware of alternatives.
 */
function buildMechanism(bp, platform) {
  const mech     = bp.unique_mechanism || bp.offer || 'המתודה הייחודית שלנו';
  const audience = bp.target_audience  || 'עסקים';
  const outcome  = bp.desired_outcome  || 'תוצאות מדידות';
  const problem  = bp.problem_solved   || 'הבעיה הישנה';
  const ctas     = getCTAs(bp.primary_goal);

  const headline = platform === 'google_ads'
    ? cap(mech, 30)
    : `💡 "${mech}"`;

  const body = platform === 'google_ads'
    ? cap(`לא כמו ${problem} — ${mech} מביא ${outcome} ל${audience}.`, 90)
    : `למה ${audience} מצליחים עם ${mech}:\n\n❌ לא עוד ${problem}\n✅ ${outcome}\n\nהסיבה: ${mech}`;

  return {
    variant:       'C',
    framework:     'mechanism',
    hook_type:     'מנגנון ייחודי',
    headline,
    body,
    cta:           ctas[2] || ctas[0],
    platform_note: platform === 'google_ads' ? 'Responsive Search Ad — הכנס את המנגנון בכותרת 1.' : 'תמונה: המנגנון בפעולה, לא תוצאה כללית',
  };
}

// ── Bottleneck prioritization ──────────────────────────────────────────────────

/**
 * bottleneckOrder(bottleneck)
 * Returns the framework order that best addresses the identified bottleneck.
 * Default order when no bottleneck: A → B → C.
 */
function bottleneckOrder(bottleneck) {
  switch (bottleneck) {
    case 'creative':
    case 'ctr':
      // CTR problem → lead with problem hook (pattern interrupt), then result
      return ['problem_agitate', 'result_first', 'mechanism'];
    case 'landing_page':
    case 'conversion':
      // Conv problem → lead with result first (pre-qualify), then mechanism
      return ['result_first', 'mechanism', 'problem_agitate'];
    case 'budget':
    case 'roas':
      // ROAS problem → lead with mechanism (differentiate value), then result
      return ['mechanism', 'result_first', 'problem_agitate'];
    default:
      return ['problem_agitate', 'result_first', 'mechanism'];
  }
}

// ── Main entry point ───────────────────────────────────────────────────────────

/**
 * generateAdCopy({ businessProfile, bottleneck, platform })
 *
 * @param {object} businessProfile — from loadBusinessProfile()
 * @param {string} bottleneck      — 'ctr' | 'conversion' | 'roas' | 'creative' | 'landing_page' | null
 * @param {string} platform        — 'meta' | 'google_ads' (default: 'meta')
 *
 * @returns {AdVariant[]}
 *   Each variant: { variant, framework, hook_type, headline, body, cta, platform_note }
 */
function generateAdCopy({ businessProfile, bottleneck = null, platform = 'meta' }) {
  const bp = businessProfile || {};

  const builders = {
    problem_agitate: buildProblemAgitate,
    result_first:    buildResultFirst,
    mechanism:       buildMechanism,
  };

  const order = bottleneckOrder(bottleneck);

  // Build in bottleneck-prioritised order, re-label as A/B/C
  const variants = order.map((framework, idx) => {
    const built = builders[framework](bp, platform);
    return { ...built, variant: String.fromCharCode(65 + idx) }; // A, B, C
  });

  return variants;
}

/**
 * formatCopyCard(variant, idx)
 * Returns a Hebrew markdown card for one copy variant.
 */
function formatCopyCard(variant) {
  let card = `**וריאציה ${variant.variant} — ${variant.hook_type}** (${variant.framework})\n`;
  card += `  🔤 **כותרת:** ${variant.headline}\n`;
  card += `  📝 **גוף:**\n${variant.body.split('\n').map(l => `    ${l}`).join('\n')}\n`;
  card += `  🔘 **CTA:** ${variant.cta}\n`;
  card += `  💡 _${variant.platform_note}_`;
  return card;
}

module.exports = {
  generateAdCopy,
  formatCopyCard,
};
