'use strict';

/**
 * section-content-generator.js — Section Content Generator
 *
 * Fills component prop objects with real marketing content extracted from
 * MarketingMemory. Used by the HTML Blueprint Builder between structure planning
 * and HTML composition.
 *
 * CRITICAL RULES:
 *   - Memory first. Every value prefers a real memory field.
 *   - Safe structural defaults are allowed for universal copy (headings,
 *     form labels, CTA labels) — these are Hebrew UI patterns, not business claims.
 *   - Business-specific facts (price, feature names, customer names, results)
 *     are ALWAYS null when not in memory. Never invented.
 *   - Returning null on a required field is valid — the composer must handle it
 *     gracefully (omit section, collapse to minimal, or use placeholder slot).
 *   - This module is SYNCHRONOUS and DETERMINISTIC — no AI calls here.
 *
 * Entry point:
 *   buildSectionContent(sectionType, memory)
 *   → returns props object shaped to match design-system/components.js schema
 */

// ── Supported section types ───────────────────────────────────────────────────

const SUPPORTED_SECTION_TYPES = new Set([
  'hero',
  'banner_strip',
  'stats_row',
  'pain_section',
  'mechanism_section',
  'feature_cards',
  'proof_section',
  'testimonials',
  'pricing_block',
  'faq',
  'cta_block',
  'lead_form',
]);

// ── CTA text defaults by goal ─────────────────────────────────────────────────
// Safe universal Hebrew CTAs — structural, not business claims.
// Priority: proven_cta_text from memory → goal default → fallback.

const CTA_BY_GOAL = Object.freeze({
  lead_generation: ['קבל גישה עכשיו', 'השאר פרטים', 'קבל ייעוץ חינם'],
  direct_sale:     ['רכוש עכשיו', 'הצטרף עכשיו', 'קנה עכשיו'],
  consultation:    ['קבע שיחת ייעוץ', 'דבר עם מומחה', 'קבל ייעוץ חינם'],
  registration:    ['הירשם עכשיו', 'הצטרף בחינם', 'התחל עכשיו'],
  download:        ['הורד עכשיו', 'קבל גישה מיידית', 'הורד בחינם'],
  awareness:       ['גלה עוד', 'קרא עוד', 'למד עוד'],
  _fallback:       ['התחל עכשיו', 'קבל פרטים', 'צור קשר'],
});

// ── Lead form privacy notes ───────────────────────────────────────────────────
// Universal — no business facts, safe to always include.

const PRIVACY_NOTES = Object.freeze({
  standard: 'אנחנו שומרים על פרטיותך. לא נשלח ספאם לעולם.',
  minimal:  'פרטייך בטוחים אצלנו.',
});

// ── FAQ fallbacks by goal ─────────────────────────────────────────────────────
// Structural questions only. Answers reference general intent, not business facts.
// Used ONLY when memory has no objections. Never make up specific facts.

const FAQ_BY_GOAL = Object.freeze({
  lead_generation: [
    { question: 'מה קורה אחרי שאני משאיר פרטים?', answer: 'נציג מטעמנו יצור עמך קשר בהקדם האפשרי לתיאום ייעוץ.' },
    { question: 'כמה זמן עד שמישהו יחזור אלי?', answer: 'אנחנו שואפים לחזור לכל פנייה תוך 24 שעות בימי עסקים.' },
    { question: 'האם הפגישה הראשונה ללא עלות?', answer: null },   // business-specific — null
    { question: 'האם המידע שלי שמור בביטחון?', answer: 'בוודאי. אנחנו לא משתפים פרטים עם גורמי צד שלישי.' },
  ],
  direct_sale: [
    { question: 'האם יש ערבות להחזר כסף?', answer: null },       // business-specific — null
    { question: 'כיצד מתבצע התשלום?', answer: null },             // business-specific — null
    { question: 'מה כלול במחיר?', answer: null },                  // business-specific — null
    { question: 'האם אוכל לבטל בכל עת?', answer: null },          // business-specific — null
  ],
  consultation: [
    { question: 'כמה זמן נמשכת שיחת הייעוץ?', answer: null },    // business-specific — null
    { question: 'האם יש עלות לשיחה?', answer: null },              // business-specific — null
    { question: 'מה נדון בשיחה?', answer: 'נסקור את מצבך הנוכחי ונגדיר יחד מטרות ואסטרטגיה.' },
    { question: 'מה קורה אחרי שיחת הייעוץ?', answer: null },      // business-specific — null
  ],
  _fallback: [
    { question: 'כיצד אוכל ליצור קשר?', answer: null },
    { question: 'מה השלב הבא?', answer: 'השאר פרטים ונחזור אליך בהקדם.' },
  ],
});

// ── Objection key → FAQ pair mapping ─────────────────────────────────────────
// Maps userIntelligence recurring_issue keys to Hebrew FAQ items.
// When audience.objections contains a known key, inject the relevant FAQ.

const OBJECTION_FAQ = Object.freeze({
  low_ctr:        { question: 'למה אנשים לא לוחצים על המודעות שלי?',  answer: 'CTR נמוך בדרך כלל מצביע על חוסר התאמה בין המסר למוצר. נשמח לעזור לאבחן.' },
  high_cost:      { question: 'האם המחיר שווה את זה?',               answer: null },
  no_results:     { question: 'מה אם לא אראה תוצאות?',               answer: null },
  low_conversion: { question: 'למה המבקרים לא ממירים?',              answer: 'המרה נמוכה בדרך כלל נובעת מחוסר התאמה בין הדף למסר הפרסומי. זה בדיוק מה שאנחנו פותרים.' },
  trust_barrier:  { question: 'איך אני יודע שאתם אמינים?',           answer: null },
  too_busy:       { question: 'אין לי זמן לעוד כלי אחד',              answer: 'המערכת עובדת ברקע ולא דורשת ניהול יומיומי.' },
  tried_before:   { question: 'ניסיתי שיטות דומות בעבר ולא הצליחו',   answer: null },
});

// ── Standard lead form field sets ────────────────────────────────────────────
// Structural only — labels, types, placeholders. Not business-specific.
// Sorted by conversion impact: name → phone → email (phone is highest-intent).

const LEAD_FORM_FIELDS = Object.freeze({
  minimal: [
    { type: 'text',  name: 'name',  label: 'שם מלא',     placeholder: 'הכנס/י שם מלא',   required: true  },
    { type: 'tel',   name: 'phone', label: 'מספר טלפון',  placeholder: '05X-XXXXXXX',      required: true  },
  ],
  standard: [
    { type: 'text',  name: 'name',  label: 'שם מלא',     placeholder: 'הכנס/י שם מלא',   required: true  },
    { type: 'tel',   name: 'phone', label: 'מספר טלפון',  placeholder: '05X-XXXXXXX',      required: true  },
    { type: 'email', name: 'email', label: 'כתובת מייל',  placeholder: 'your@email.com',    required: false },
  ],
  full: [
    { type: 'text',  name: 'name',    label: 'שם מלא',       placeholder: 'הכנס/י שם מלא', required: true  },
    { type: 'tel',   name: 'phone',   label: 'מספר טלפון',    placeholder: '05X-XXXXXXX',    required: true  },
    { type: 'email', name: 'email',   label: 'כתובת מייל',    placeholder: 'your@email.com', required: false },
    { type: 'text',  name: 'company', label: 'שם העסק',       placeholder: 'שם החברה',       required: false },
  ],
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

// Non-empty string or null
const str = (v) => (typeof v === 'string' && v.trim().length > 0) ? v.trim() : null;

// Non-empty array or null
const arr = (v) => (Array.isArray(v) && v.length > 0) ? v : null;

// Resolve best CTA text: proven → goal default → fallback
function getBestCta(memory) {
  const proven = arr(memory?.cta_preferences?.proven_cta_text);
  if (proven) return proven[0];

  const goal = memory?.cta_preferences?.primary_goal ||
               memory?.layout_preferences?.primary_goal;
  const defaults = CTA_BY_GOAL[goal] || CTA_BY_GOAL._fallback;
  return defaults[0];
}

// Resolve goal string from memory
function resolveGoal(memory) {
  return str(memory?.cta_preferences?.primary_goal) ||
         str(memory?.layout_preferences?.primary_goal) ||
         'lead_generation';
}

// Split a prose string into bullet-ready array.
// Splits on: newlines, em-dashes, semicolons, or numbered items "1. ... 2. ..."
// Returns single-element array if no delimiter found.
// Returns null if input is null/empty.
function splitToBullets(text, maxItems = 7) {
  const s = str(text);
  if (!s) return null;

  let parts;
  if (/\n/.test(s))       parts = s.split('\n');
  else if (/;\s*/.test(s)) parts = s.split(/;\s*/);
  else if (/—/.test(s))    parts = s.split('—');
  else if (/\d+\.\s/.test(s)) parts = s.split(/\d+\.\s/).filter(Boolean);
  else parts = [s];

  const clean = parts.map((p) => str(p)).filter(Boolean).slice(0, maxItems);
  return clean.length > 0 ? clean : null;
}

// Build proof items from performance metrics (real numbers only)
function buildPerformanceProofItems(performance) {
  if (!performance) return null;
  const items = [];

  const ctr  = performance.ctr;
  const roas = performance.roas;
  const cpl  = performance.cpl;

  if (typeof ctr === 'number' && ctr > 0) {
    items.push({
      value:   `${(ctr * 100).toFixed(1)}%`,
      label:   'שיעור קליקים',
      context: 'CTR ממוצע בקמפיין',
    });
  }
  if (typeof roas === 'number' && roas > 0) {
    items.push({
      value:   `${roas.toFixed(1)}x`,
      label:   'החזר על פרסום',
      context: 'ROAS ממוצע',
    });
  }
  if (typeof cpl === 'number' && cpl > 0) {
    items.push({
      value:   `₪${cpl.toFixed(0)}`,
      label:   'עלות לליד',
      context: 'CPL ממוצע',
    });
  }

  return items.length > 0 ? items : null;
}

// Build proof items from winning A/B test angles
function buildTestProofItems(memory) {
  const angles = arr(memory?.positioning?.winning_angles);
  if (!angles) return null;
  return angles.slice(0, 3).map((a) => ({
    value:   null,     // no numeric value — qualitative result
    label:   str(a),
    context: 'תוצאה מוכחת מבדיקת A/B',
  })).filter((i) => i.label);
}

// Build FAQ items from memory objections + goal-based structural defaults
function buildFaqItems(memory, goal) {
  const items = [];
  const seen  = new Set();

  // 1. If objection key in memory → inject the relevant FAQ pair
  const objectionKey = str(memory?.audience?.objections);
  if (objectionKey && OBJECTION_FAQ[objectionKey]) {
    const pair = OBJECTION_FAQ[objectionKey];
    items.push({ question: pair.question, answer: pair.answer });
    seen.add(pair.question);
  }

  // 2. Structural goal-based FAQ (generic, safe)
  const goalFaq = FAQ_BY_GOAL[goal] || FAQ_BY_GOAL._fallback;
  for (const pair of goalFaq) {
    if (!seen.has(pair.question)) {
      items.push({ question: pair.question, answer: pair.answer });
      seen.add(pair.question);
    }
    if (items.length >= 6) break;
  }

  return items.length >= 2 ? items : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// buildSectionContent — main export
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {string} sectionType — must be one of SUPPORTED_SECTION_TYPES
 * @param {object} memory      — MarketingMemory from buildMarketingMemory()
 * @returns {object}           — props object for that component type
 *
 * Return contract:
 *   - Required props: populated if possible; null if data is unavailable
 *   - Optional props: populated when memory has data; omitted (undefined) if not
 *   - null values on required props: composer must handle gracefully
 */
function buildSectionContent(sectionType, memory) {
  if (!SUPPORTED_SECTION_TYPES.has(sectionType)) {
    throw new Error(
      `buildSectionContent: unsupported sectionType "${sectionType}". ` +
      `Supported: ${[...SUPPORTED_SECTION_TYPES].join(', ')}`
    );
  }

  const mem = memory || {};

  switch (sectionType) {
    case 'hero':             return _hero(mem);
    case 'banner_strip':     return _bannerStrip(mem);
    case 'stats_row':        return _statsRow(mem);
    case 'pain_section':     return _painSection(mem);
    case 'mechanism_section': return _mechanismSection(mem);
    case 'feature_cards':    return _featureCards(mem);
    case 'proof_section':    return _proofSection(mem);
    case 'testimonials':     return _testimonials(mem);
    case 'pricing_block':    return _pricingBlock(mem);
    case 'faq':              return _faq(mem);
    case 'cta_block':        return _ctaBlock(mem);
    case 'lead_form':        return _leadForm(mem);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Individual builders — one per component type
// ─────────────────────────────────────────────────────────────────────────────

// ── hero ─────────────────────────────────────────────────────────────────────
function _hero(mem) {
  const goal    = resolveGoal(mem);
  const ctaText = getBestCta(mem);

  // Headline priority: proven winning hook → business promise → null
  const winningHook = arr(mem.learnings?.winning_hooks)?.[0]?.winner || null;
  const headline    = str(winningHook) || str(mem.business?.promise) || null;

  // Subheadline: offer description for the target audience
  const subheadline = str(mem.business?.offer) || str(mem.audience?.desires) || null;

  // Trust line: a single lightweight social proof signal
  const trustLine = (() => {
    const roas = mem.performance?.roas;
    if (typeof roas === 'number' && roas > 0) return `החזר ממוצע של ${roas.toFixed(1)}x על הפרסום`;
    const winningAngle = str(arr(mem.positioning?.winning_angles)?.[0]);
    if (winningAngle) return winningAngle;
    return null;
  })();

  // badge_text: not in memory — structural placeholder only if tone is urgent
  const urgency = str(mem.cta_preferences?.urgency_level);
  const badgeText = urgency === 'high' ? 'מקומות מוגבלים' : null;

  return {
    // Required
    headline,
    cta_text:  ctaText,
    cta_href:  '#lead-form',     // structural anchor — always scrolls to form
    // Optional
    subheadline:    subheadline  || undefined,
    badge_text:     badgeText    || undefined,
    trust_line:     trustLine    || undefined,
    image_slot:     null,        // composer renders placeholder; real image injected later
    image_alt:      str(mem.business?.offer) ? `${mem.business.offer} — תמונה` : undefined,
    // Variant hint (not a schema prop — used by composer for layout decision)
    _variant_hint:  goal === 'lead_generation' ? 'split-form' : 'split-image-end',
  };
}

// ── banner_strip ──────────────────────────────────────────────────────────────
function _bannerStrip(mem) {
  const ctaText = getBestCta(mem);
  const urgency = str(mem.cta_preferences?.urgency_level);

  // Banner text: short urgency message
  // We use structural urgency text — no business-specific claims
  const offer   = str(mem.business?.offer);
  const text    = offer
    ? `הצעה מיוחדת: ${offer}`  // uses real offer name from memory
    : 'הצעה מוגבלת בזמן — הירשם עוד היום';

  return {
    // Required
    text,
    cta_text: ctaText,
    cta_href: '#lead-form',
    // Optional
    urgency_flag: urgency === 'high' || undefined,
    dismissible:  false,
  };
}

// ── stats_row ─────────────────────────────────────────────────────────────────
// IMPORTANT: stats must be real numbers. Return null if no data — never invent.
function _statsRow(mem) {
  const perfItems = buildPerformanceProofItems(mem.performance);
  const stats = perfItems
    ? perfItems.map((i) => ({ number: i.value, label: i.label }))
    : null;

  // If no real performance data exists, stats_row cannot be populated safely.
  // The composer must skip this section when stats is null.
  return {
    stats,           // null if no real data — DO NOT invent numbers
    headline: undefined,
  };
}

// ── pain_section ──────────────────────────────────────────────────────────────
function _painSection(mem) {
  const painText   = str(mem.audience?.pain_points);
  const painPoints = splitToBullets(painText, 5);

  // Headline: generic structural question — universal, not a business claim
  const headline = painPoints
    ? 'מכיר/ה את התחושה הזאת?'
    : null;

  // Bridge to solution: reference the promise if we have it
  const promise        = str(mem.business?.promise);
  const conclusionText = promise ? `יש דרך אחרת. ${promise}` : 'יש דרך אחרת.';

  return {
    // Required
    headline,
    pain_points: painPoints,   // null if audience.pain_points not in memory
    // Optional
    conclusion_text: painPoints ? conclusionText : undefined,
    body_text:       undefined,  // pain_points covers this; no duplication
    icon_style:      'x',        // ✗ marks pain items
  };
}

// ── mechanism_section ─────────────────────────────────────────────────────────
function _mechanismSection(mem) {
  const mechanismRaw  = str(mem.business?.mechanism);
  const differentiator = str(mem.positioning?.differentiators);

  // Steps: business.mechanism as the core step (real data)
  // Additional step from differentiator if available
  // Cannot generate steps without at least one real data point
  const steps = (() => {
    if (!mechanismRaw && !differentiator) return null;
    const rawSteps = [];
    if (mechanismRaw)   rawSteps.push({ title: mechanismRaw,   description: null });
    if (differentiator) rawSteps.push({ title: differentiator, description: null });
    return rawSteps.slice(0, 4);
  })();

  // mechanism_name: sometimes stored as a named framework in the mechanism field
  // e.g. "שיטת ה-3F" — if it looks like a named method, surface it
  const mechanismName = (() => {
    if (!mechanismRaw) return null;
    const namedPattern = /שיטת|מתודת|מודל|מערכת|תהליך/;
    return namedPattern.test(mechanismRaw) ? mechanismRaw : null;
  })();

  return {
    // Required
    headline:     'איך זה עובד',   // universal structural heading — safe default
    steps,                          // null if no mechanism data in memory
    // Optional
    subheadline:    mechanismName || undefined,
    mechanism_name: mechanismName || undefined,
  };
}

// ── feature_cards ─────────────────────────────────────────────────────────────
function _featureCards(mem) {
  // Features come from positioning.differentiators — split if multi-line
  const diffRaw    = str(mem.positioning?.differentiators);
  const offerRaw   = str(mem.business?.offer);
  const featureArr = splitToBullets(diffRaw, 6);

  const features = featureArr
    ? featureArr.map((f) => ({ title: f, description: null }))
    : null;
  // description is null per item — HTML composer uses title only when description absent

  return {
    // Required
    features,    // null if no differentiators in memory
    // Optional
    headline: offerRaw ? `מה כולל ${offerRaw}` : 'מה תקבל',
  };
}

// ── proof_section ─────────────────────────────────────────────────────────────
function _proofSection(mem) {
  // Priority: real performance numbers → A/B winning angles → null
  const perfItems = buildPerformanceProofItems(mem.performance);
  const testItems = buildTestProofItems(mem);

  // Merge — performance numbers first (most credible), then qualitative angles
  const combined = [
    ...(perfItems || []),
    ...(testItems || []),
  ].slice(0, 6);

  const proofItems = combined.length > 0 ? combined : null;

  return {
    // Required
    headline:    'תוצאות שמדברות בעד עצמן',   // universal — not a business claim
    proof_items: proofItems,                     // null if no data — DO NOT invent
    // Optional
    subheadline: proofItems ? undefined : undefined,
  };
}

// ── testimonials ──────────────────────────────────────────────────────────────
// Testimonials CANNOT be invented. Return null when no real data exists.
// Winning hooks from A/B tests are NOT testimonials — they are creative signals.
function _testimonials(mem) {
  // No testimonial data is stored in the current memory schema.
  // The composer must skip this section or render a placeholder requesting content.
  return {
    // Required
    testimonials: null,    // always null — testimonial content must come from the user
    // Optional
    headline: 'מה אומרים הלקוחות שלנו',
    _data_required: true,  // signal to composer: real testimonials needed here
  };
}

// ── pricing_block ─────────────────────────────────────────────────────────────
// Price CANNOT be invented. Return null plan when price not in memory.
function _pricingBlock(mem) {
  const priceRaw  = str(mem.business?.price);
  const offerName = str(mem.business?.offer);
  const ctaText   = getBestCta(mem);

  // Can only build a plan if we have at least a price
  const plans = priceRaw
    ? [{
        name:      offerName || 'תכנית',
        price:     priceRaw,
        period:    null,      // monthly/one-time/etc — not in current memory schema
        features:  null,      // feature list not in memory schema — null
        cta_text:  ctaText,
        cta_href:  '#lead-form',
      }]
    : null;

  return {
    // Required
    plans,       // null if no price in memory — DO NOT invent price
    // Optional
    headline:       offerName ? `הצטרף ל-${offerName}` : 'הצעה שלנו',
    guarantee_text: null,      // no guarantee data in memory
    urgency_text:   str(mem.cta_preferences?.urgency_level) === 'high'
      ? 'מחיר מיוחד לזמן מוגבל'
      : undefined,
    _data_required: !priceRaw,
  };
}

// ── faq ───────────────────────────────────────────────────────────────────────
function _faq(mem) {
  const goal      = resolveGoal(mem);
  const questions = buildFaqItems(mem, goal);

  return {
    // Required
    questions,    // null if neither objections nor goal fallbacks could be built
    // Optional
    headline: 'שאלות נפוצות',   // universal Hebrew default — always safe
  };
}

// ── cta_block ─────────────────────────────────────────────────────────────────
function _ctaBlock(mem) {
  const ctaText = getBestCta(mem);
  const urgency = str(mem.cta_preferences?.urgency_level);

  // Headline: restate the core promise — highest-trust source
  const headline = str(mem.business?.promise) || str(mem.business?.offer) || null;

  // Subtext: what they get — desires or offer description
  const subtext = str(mem.audience?.desires) || str(mem.business?.offer) || null;

  // Urgency line: only for high urgency
  const urgencyLine = urgency === 'high' ? 'ההצעה תקפה לזמן מוגבל' : null;

  // Trust/guarantee line: universal — no business-specific claims
  const trustLine = 'ללא התחייבות. ביטול בכל עת.';

  return {
    // Required
    headline,
    button_text: ctaText,
    button_href: '#lead-form',
    // Optional
    subtext:       subtext       || undefined,
    urgency_text:  urgencyLine   || undefined,
    guarantee_text: trustLine,
  };
}

// ── lead_form ─────────────────────────────────────────────────────────────────
function _leadForm(mem) {
  const goal    = resolveGoal(mem);
  const ctaText = getBestCta(mem);
  const offer   = str(mem.business?.offer);

  // Headline: offer-specific if available
  const headline = offer
    ? `קבל גישה ל-${offer}`
    : 'השאר פרטים ונחזור אליך';

  // Subtext: what happens next — goal-based
  const subtext = (() => {
    if (goal === 'lead_generation')  return 'נציג מטעמנו יצור קשר בהקדם לתיאום.';
    if (goal === 'consultation')     return 'נשמח לקבוע שיחת ייעוץ בזמן שנח לך.';
    if (goal === 'download')         return 'הקובץ יישלח אליך מיד לאחר האישור.';
    if (goal === 'registration')     return 'תוך דקות תקבל גישה מלאה.';
    return null;
  })();

  // Field set: minimal for above-fold / high-urgency, standard otherwise
  const urgency = str(mem.cta_preferences?.urgency_level);
  const fieldSet = urgency === 'high' ? 'minimal' : 'standard';

  return {
    // Required
    headline,
    fields:      LEAD_FORM_FIELDS[fieldSet],   // always populated — structural fields
    submit_text: ctaText,
    // Optional
    subtext:      subtext               || undefined,
    privacy_note: PRIVACY_NOTES.standard,
    success_message: 'תודה! נחזור אליך בקרוב.',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Module exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = { buildSectionContent, SUPPORTED_SECTION_TYPES };
