'use strict';

/**
 * creative-context-pack.js — Asset-Type Context Selector
 *
 * Selects the most relevant marketing memory fields for a specific visual asset type.
 * The creative engine receives a focused context pack instead of the full memory object.
 *
 * Prevents context pollution: each asset type has different creative priorities.
 * Passing the full memory to every asset type dilutes signal with irrelevant noise.
 *
 * Usage:
 *   const { buildCreativeContext } = require('./_shared/creative-context-pack');
 *   const pack = buildCreativeContext(memory, 'ad_visual');
 *
 * Input:  memory    — output of buildMarketingMemory()
 *         assetType — one of SUPPORTED_ASSET_TYPES
 *
 * Output: focused context object shaped for the specific asset type
 */

const SUPPORTED_ASSET_TYPES = new Set([
  'ad_visual',     // cold-traffic feed ad — stop the scroll
  'landing_hero',  // above-the-fold hero section — convert the click
  'banner',        // display network — one message, brand recall
  'retargeting',   // warm audience — remove the hesitation
  'proof_visual',  // trust asset — make the promise feel real
]);

// ── Safe access helpers ────────────────────────────────────────────────────────

// Return value only if non-empty string
const str   = (v) => (typeof v === 'string' && v.trim().length > 0) ? v.trim() : null;

// Return value only if finite number
const num   = (v) => (typeof v === 'number' && isFinite(v)) ? v : null;

// Return array only if non-empty
const arr   = (v) => (Array.isArray(v) && v.length > 0) ? v : null;

// Flatten winning_hooks to plain strings for prompt consumption
const flatHooks = (hooks) => arr(hooks)
  ? hooks.map((h) => h.summary || h.winner).filter(Boolean)
  : null;

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * buildCreativeContext(memory, assetType)
 *
 * @param {object} memory     — full MarketingMemory object from buildMarketingMemory()
 * @param {string} assetType  — one of SUPPORTED_ASSET_TYPES
 * @returns {object}          — focused creative context pack
 */
function buildCreativeContext(memory, assetType) {
  if (!memory || !assetType) {
    return { asset_type: assetType || null, error: 'MISSING_INPUT' };
  }

  if (!SUPPORTED_ASSET_TYPES.has(assetType)) {
    return { asset_type: assetType, error: `UNSUPPORTED_ASSET_TYPE — valid: ${[...SUPPORTED_ASSET_TYPES].join(', ')}` };
  }

  // Destructure with safe defaults — callers may pass partial memory
  const {
    business    = {},
    audience    = {},
    positioning = {},
    performance = {},
    learnings   = {},
    current     = {},
  } = memory || {};

  switch (assetType) {
    case 'ad_visual':    return buildAdVisual(business, audience, positioning, performance, learnings, current);
    case 'landing_hero': return buildLandingHero(business, audience, positioning, performance, learnings, current);
    case 'banner':       return buildBanner(business, audience, positioning, performance, learnings, current);
    case 'retargeting':  return buildRetargeting(business, audience, positioning, performance, learnings, current);
    case 'proof_visual': return buildProofVisual(business, audience, positioning, performance, learnings, current);
  }
}

// ── AD_VISUAL ─────────────────────────────────────────────────────────────────
//
// Context: cold traffic in a social feed — 1–2 seconds of attention
// Priority: pain_points > emotional trigger > differentiator > message
//
// Why: cold audiences don't know the brand yet.
// The fastest hook is showing them their own problem.
// Differentiator comes second — after they feel seen, they want to know why you.

function buildAdVisual(business, audience, positioning, performance, learnings, current) {
  // Pain is the primary scroll-stopper for cold traffic
  // If pain is missing, fall back to the aspiration (desire)
  const emotionalTrigger = str(audience.pain_points) || str(audience.desires) || null;

  // Primary message = the single thing that makes this worth clicking
  // Differentiator beats generic offer — cold traffic is skeptical
  const primaryMessage =
    str(positioning.differentiators) ||
    str(business.promise)            ||
    str(business.offer)              ||
    null;

  // CTR flag: if CTR is the current bottleneck, creative must be more disruptive
  const ctrNote = performance.top_bottleneck === 'ctr'
    ? 'CTR ביצועים נמוכים כרגע — הקריאייטיב הנוכחי לא עוצר גלילה. דרוש pattern interrupt חזק.'
    : null;

  // Proven hooks from concluded A/B tests are the highest-signal creative input
  const provenHooks = flatHooks(learnings.winning_hooks);

  return {
    asset_type: 'ad_visual',

    // Stop scroll → generate click from cold audience
    objective: 'עצור גלילה תוך 2 שניות ויצר קליק מקהל קר',

    // Who will see this in the feed
    target_audience: str(business.audience) || null,

    // Lead with pain — recognition is the fastest hook
    core_emotional_trigger: emotionalTrigger,

    // What the visual + text combination must communicate at a glance
    primary_message: primaryMessage,

    // What separates this from every other ad in the feed
    differentiator: str(positioning.differentiators) || null,

    // Most likely reason they'd scroll past — visual must pre-empt it
    objection: str(audience.objections) || null,

    // The exact thought the viewer should have within 2 seconds
    desired_2_second_reaction: str(audience.pain_points)
      ? `"זה בדיוק הבעיה שלי" — recognition of pain`
      : str(business.audience)
        ? `"זה מדבר אליי" — recognition as the target audience`
        : null,

    // Cold traffic = awareness/interest stage — visual mood should match
    funnel_stage: str(current.funnel_stage) || 'awareness',

    // Meta feed hard rules
    visual_constraints: {
      format:       '1:1 or 4:5 for feed; 9:16 for stories/reels',
      text_overlay: 'maximum 20% of image area',
      first_frame:  'hook must be visible without reading — visual alone tells the story',
      safe_zone:    'avoid bottom 20% — overlaps with UI elements on mobile',
    },

    // Copy tone and visual mood guidance
    tone_guidance: str(business.tone) || null,

    // Additional creative intelligence — use when available
    supporting_context: {
      winning_angles:   arr(positioning.winning_angles) || null,
      proven_hooks:     provenHooks,
      performance_note: ctrNote,
      active_issue:     str(current.main_issue) || null,
    },
  };
}

// ── LANDING_HERO ──────────────────────────────────────────────────────────────
//
// Context: warm traffic — they already clicked the ad and arrived
// Priority: promise > trust > mechanism > outcome
//
// Why: the visitor already knows the problem. They clicked because they want the solution.
// Hero section must immediately validate their decision to click (message match)
// and give them a reason to believe the promise is real.

function buildLandingHero(business, audience, positioning, performance, learnings, current) {
  // Promise = hero headline. Must match what the ad said (message continuity)
  const primaryMessage =
    str(business.promise)            ||
    str(positioning.differentiators) ||
    str(business.offer)              ||
    null;

  // Mechanism = the "how" — answers "why you and not anyone else"
  // This is the trust-building layer, second most important for landing pages
  const differentiator =
    str(business.mechanism)          ||
    str(positioning.differentiators) ||
    null;

  // Aspiration drives above-fold engagement — show the life after transformation
  // For landing pages, desires > pain (they already acknowledged the pain by clicking)
  const emotionalTrigger =
    str(audience.desires)     ||
    str(audience.pain_points) || // fallback: re-activate pain if no desire signal
    null;

  // Conversion rate flag: if conversion is the bottleneck, hero needs stronger trust signals
  const convNote = performance.top_bottleneck === 'conversion'
    ? 'שיעור המרה חלש — hero צריך חיזוק אמינות: הוכחה חברתית, מספרים, או ערבות.'
    : null;

  const provenHooks = flatHooks(learnings.winning_hooks);

  return {
    asset_type: 'landing_hero',

    // Convert visitor to lead/purchase — message match from ad is essential
    objective: 'המר מבקר לליד תוך 5 שניות — חזק את ההבטחה מהמודעה',

    // Traffic that clicked from a targeted ad
    target_audience: str(business.audience) || null,

    // Aspiration-led — visitor clicked to get the outcome, show it to them
    core_emotional_trigger: emotionalTrigger,

    // Hero headline: the promise above the fold
    primary_message: primaryMessage,

    // Unique mechanism: why this works when other things didn't
    differentiator: differentiator,

    // Main objection to address in hero section (price, credibility, effort, timing)
    objection: str(audience.objections) || null,

    // What they should feel as the hero section loads
    desired_2_second_reaction: str(audience.desires)
      ? `"זה בדיוק מה שאני רוצה — ואפשרי עבורי" — aspiration validated`
      : str(business.promise)
        ? `"זה נשמע אמיתי ורלוונטי" — promise credible`
        : null,

    // Landing hero is always consideration/decision stage
    funnel_stage: str(current.funnel_stage) || 'consideration',

    // Above-the-fold structural constraints
    visual_constraints: {
      above_fold:      'headline + subheadline + CTA button + one trust element must all be visible without scrolling',
      image_role:      'show the outcome/transformation — not the process or the product',
      trust_elements:  'social proof number, logo bar, or result stat visible above fold',
      mobile_priority: 'design for mobile-first — majority of traffic is mobile',
    },

    // Landing pages use credible/professional tone — urgency without pressure
    tone_guidance: str(business.tone) || null,

    // Designer context
    supporting_context: {
      offer_detail:     str(business.offer)  || null,
      price_anchor:     str(business.price)  || null,
      proven_headlines: provenHooks,
      performance_note: convNote,
      winning_angles:   arr(positioning.winning_angles) || null,
    },
  };
}

// ── BANNER ────────────────────────────────────────────────────────────────────
//
// Context: display network — tiny format, fraction of a second
// Priority: single message > clarity > CTA support
//
// Why: banners cannot carry arguments. One idea, instantly readable.
// Brand recall and direct-click are the only viable goals.

function buildBanner(business, audience, positioning, performance, learnings, current) {
  // Banners can carry exactly ONE message — the sharpest one available
  // Promise beats offer: "100 לידים בחודש" beats "קורס דיגיטל 8 שבועות"
  const primaryMessage =
    str(business.promise)            ||
    str(positioning.differentiators) ||
    str(business.offer)              ||
    null;

  return {
    asset_type: 'banner',

    // One clear message — brand recall or direct click
    objective: 'מסר יחיד וברור — brand recall או קליק ישיר',

    // Target for alt text and creative tone calibration
    target_audience: str(business.audience) || null,

    // Hint at the reward — brevity is the trigger in display format
    core_emotional_trigger:
      str(audience.desires)     ||
      str(audience.pain_points) ||
      null,

    // The ONE line this banner communicates — nothing else
    primary_message: primaryMessage,

    // Ultra-short differentiator: 3–5 words max at banner scale
    differentiator: str(positioning.differentiators) || null,

    // No space for objection handling in a banner format
    objection: null,

    // Minimal goal — intrigue is enough at this format
    desired_2_second_reaction: `"מעניין — לחץ לפרטים"`,

    funnel_stage: str(current.funnel_stage) || null,

    // Hard display constraints
    visual_constraints: {
      formats:     '300×250 (rectangle), 728×90 (leaderboard), 160×600 (skyscraper)',
      text_limit:  'headline only — max 5 words visible at smallest format',
      logo:        'must be prominent — brand recall is the primary goal',
      cta_button:  'one CTA, high contrast, legible at minimum size',
    },

    tone_guidance: str(business.tone) || null,

    // Minimal supporting context — banner doesn't have space for strategy
    supporting_context: {
      offer_short:  str(business.offer)  || null,
      price_anchor: str(business.price)  || null,
    },
  };
}

// ── RETARGETING ───────────────────────────────────────────────────────────────
//
// Context: warm audience — seen or clicked before, did not convert
// Priority: objections > proof > friction removal > reminder
//
// Why: retargeted viewers already know the offer.
// A generic pitch is wasted on them. They need their specific hesitation addressed.
// If we know what stopped them (objections), that IS the creative brief.

function buildRetargeting(business, audience, positioning, performance, learnings, current) {
  // Objection is king — they know the offer, something stopped them
  // If we don't know the objection, reactivate the original pain
  const emotionalTrigger =
    str(audience.objections)  ||
    str(audience.pain_points) ||
    null;

  // Primary message must address why they didn't convert — not a generic pitch
  const primaryMessage = str(audience.objections)
    ? `הסרת חסם: ${audience.objections}`
    : str(business.promise) || str(business.offer) || null;

  // Proven hooks = tested and won → highest creative signal for retargeting
  const provenAngles = flatHooks(learnings.winning_hooks);

  // Failed hooks must be explicitly avoided — they already didn't work
  const avoidAngles = learnings.failed_hooks
    ? learnings.failed_hooks.map((h) => h.summary || h.failed).filter(Boolean)
    : null;

  return {
    asset_type: 'retargeting',

    // Remove the specific hesitation — not a re-sell, a barrier removal
    objective: 'הסר את ההיסוס שמנע המרה — שלח חזרה לרכישה',

    // Warm audience who has already shown intent
    target_audience: str(business.audience) || null,

    // Their specific objection, or the pain they came to solve
    core_emotional_trigger: emotionalTrigger,

    // Must address why they didn't convert — reference the known objection
    primary_message: primaryMessage,

    // Mechanism or proof removes the "but does it really work?" hesitation
    differentiator:
      str(business.mechanism)          ||
      str(positioning.differentiators) ||
      null,

    // THE objection being addressed — this is the core of the retargeting brief
    objection: str(audience.objections) || null,

    // Retargeting goal: they reconsider, not they discover
    desired_2_second_reaction: str(audience.objections)
      ? `"אולי זה יכול לפתור את הדאגה שלי" — objection addressed`
      : `"נכון, רציתי לעשות את זה" — reminder of original intent`,

    // Always consideration/decision stage — they're warm
    funnel_stage: 'consideration',

    // Visual must feel different from cold ad — they've seen it; show something new
    visual_constraints: {
      format:          '1:1 or 4:5 — maintain brand continuity with cold ad',
      differentiation: 'visually distinct from the original ad — viewer must notice this is new',
      social_proof:    'testimonial, specific number, or before/after visible at a glance',
      urgency:         'optional — only if natural; manufactured urgency damages trust with warm audience',
    },

    tone_guidance: str(business.tone) || null,

    supporting_context: {
      proven_angles:  provenAngles,
      avoid_angles:   arr(avoidAngles) || null,  // do NOT repeat hooks that already failed
      price_anchor:   str(business.price) || null,
      active_issue:   str(current.main_issue) || null,
    },
  };
}

// ── PROOF_VISUAL ──────────────────────────────────────────────────────────────
//
// Context: trust-building asset — used in feed, landing page, or retargeting
// Priority: results > credibility > specificity
//
// Why: skepticism is the conversion killer.
// A proof visual's only job is to make the promise feel real and achievable.
// Specificity (real numbers, real names, real transformations) > generic positivity.

function buildProofVisual(business, audience, positioning, performance, learnings, current) {
  // Proof visuals lead with the measurable result — the specific outcome
  const primaryMessage =
    str(business.promise) ||
    str(business.offer)   ||
    null;

  // Aspiration anchors the proof — viewer must see themselves in the result
  const emotionalTrigger =
    str(audience.desires)     ||
    str(audience.pain_points) ||
    null;

  // Proven hooks carry tested language — use them verbatim if available
  const provenHooks = flatHooks(learnings.winning_hooks);

  // Surface real performance numbers if they're worth showing
  // Only surface ROAS/CTR if the numbers are actually good — bad numbers destroy trust
  let performanceProof = null;
  if (num(performance.roas) !== null && performance.roas >= 2) {
    performanceProof = `ROAS ${performance.roas.toFixed(1)}x`;
  } else if (num(performance.cpl) !== null && performance.cpl > 0) {
    performanceProof = `עלות ליד: ₪${performance.cpl}`;
  }

  return {
    asset_type: 'proof_visual',

    // Make the promise feel real with evidence — remove skepticism
    objective: 'הפוך את ההבטחה לאמינה — הצג ראיות ספציפיות ומדידות',

    // Who should see themselves in the proof
    target_audience: str(business.audience) || null,

    // Aspiration — viewer must see themselves achieving this result
    core_emotional_trigger: emotionalTrigger,

    // The specific result being proven — must be concrete, not vague
    primary_message: primaryMessage,

    // The mechanism explains why results are repeatable — not luck
    differentiator:
      str(business.mechanism)          ||
      str(positioning.differentiators) ||
      null,

    // Preempt skepticism: "sounds too good to be true"
    objection: str(audience.objections) || null,

    // Proof makes the aspiration feel accessible
    desired_2_second_reaction: str(audience.desires)
      ? `"זה אפשרי עבורי גם" — viewer sees themselves achieving the result`
      : `"זה נראה אמיתי" — credibility established`,

    funnel_stage: str(current.funnel_stage) || null,

    // Specificity rules — vague proof is no proof
    visual_constraints: {
      format:          '1:1 or 4:5 feed; 9:16 story format for transformation narrative',
      proof_elements:  'real number, real name, before/after — specificity builds trust; vagueness destroys it',
      avoid:           'stock photos, generic smiling faces, unquantified claims',
      text:            'specific metric or direct quote legible at thumbnail size',
    },

    tone_guidance: str(business.tone) || null,

    supporting_context: {
      proven_hooks:      provenHooks,
      performance_proof: performanceProof,   // real numbers from api_cache if positive
      winning_angles:    arr(positioning.winning_angles) || null,
      price_context:     str(business.price) || null,
    },
  };
}

module.exports = { buildCreativeContext, SUPPORTED_ASSET_TYPES };
