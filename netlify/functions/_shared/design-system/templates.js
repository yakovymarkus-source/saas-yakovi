'use strict';

/**
 * design-system/templates.js — Page Layout Templates
 *
 * Defines the structural blueprint for each supported page/asset type.
 * Templates are NOT HTML. They are the rules the HTML Composer follows.
 *
 * Each template defines:
 *   id                — unique identifier (used by Blueprint Builder to select template)
 *   name              — human-readable label
 *   description       — when to use this template
 *   asset_types       — which AssetRequest types this template serves
 *   allowed_components — which component types may appear
 *   required_components — components that must always be present
 *   default_order     — default section sequence (Blueprint Builder may reorder based on goal)
 *   mobile_rules      — mobile-first rendering constraints
 *   rtl               — RTL layout assumptions
 *   layout_constraints — structural hard rules
 *   section_strategy  — guidance for Landing Structure Engine on how to arrange sections
 */

// ── Template Definitions ──────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// lp-conversion-rtl
// Full conversion landing page. For lead generation and sales.
// Use when: high-intent traffic, multiple objections to handle, longer persuasion arc.
// ─────────────────────────────────────────────────────────────────────────────
const LP_CONVERSION_RTL = Object.freeze({
  id:          'lp-conversion-rtl',
  name:        'דף נחיתה — המרה מלאה (RTL)',
  description: 'דף מלא עם ארגומנטציה שיווקית מלאה. מתאים לשיווק ישיר, lead generation, ומכירת קורסים/שירותים.',
  asset_types: ['landing_page_html'],

  allowed_components: [
    'banner_strip',
    'hero',
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
  ],

  required_components: ['hero', 'cta_block'],  // minimum viable page must have these

  // Default section order — Landing Structure Engine may adjust based on goal
  default_order: [
    'banner_strip',        // optional: urgency or announcement at top
    'hero',                // always first visible section
    'stats_row',           // optional: quick authority signal after hero
    'pain_section',        // establish the problem — why they need this
    'mechanism_section',   // explain HOW it works — builds trust
    'proof_section',       // show it works — removes skepticism
    'testimonials',        // social proof — reduces perceived risk
    'pricing_block',       // or lead_form if lead-gen, not sales
    'faq',                 // handle remaining objections
    'cta_block',           // final conversion action
  ],

  mobile_rules: {
    breakpoint:           'md',         // single column below 768px
    hero_image_position:  'below-text', // hero image goes below copy on mobile
    nav:                  'none',       // no navigation — keeps focus on CTA
    font_scale_mobile:    0.9,          // slightly smaller fonts on mobile
    cta_width_mobile:     '100%',       // CTA buttons full-width on mobile
    sticky_cta:           true,         // optional sticky bottom CTA bar on mobile
    sections_padding_x:   '16px',       // tighter horizontal padding on small screens
  },

  rtl: {
    dir:        'rtl',
    lang:       'he',
    text_align: 'right',
    // For split layouts (image + text): image on right side by default in RTL
    // because the reading eye in Hebrew enters from the right
    split_image_side: 'end',    // in RTL "end" = left — image on left, text on right
  },

  layout_constraints: {
    max_width:           '1280px',
    container:           'wide',
    section_padding_y:   '80px',
    section_padding_y_sm: '48px',
    no_horizontal_scroll: true,
    no_nav:              true,   // landing pages hide navigation to reduce distractions
    no_footer_links:     true,   // footer shows only privacy/terms — no outbound links
    hero_min_height:     '70vh',
    form_above_fold_when: 'lead_generation',  // for lead-gen goals, form may be in hero
  },

  section_strategy: {
    // Pain before mechanism: establish WHY before explaining HOW
    pain_before_mechanism: true,
    // Proof after mechanism: show evidence AFTER explaining the method
    proof_after_mechanism: true,
    // Multiple CTAs: one mid-page and one final
    cta_count:             'multiple',  // 'single' | 'multiple'
    // FAQ placement: always before final CTA to clear last objections
    faq_before_final_cta:  true,
    // Testimonials: after proof section, before pricing
    testimonials_placement: 'after-proof',
    // If goal is lead_generation: show lead_form instead of pricing_block
    // If goal is direct_sale: show pricing_block
    conversion_component:  'goal-dependent',
  },

  // Section alternation — prevents visual monotony
  // 'default' = bg_base | 'alt' = bg_subtle | 'dark' = bg_dark
  section_backgrounds: {
    hero:              'default',
    stats_row:         'muted',
    pain_section:      'alt',
    mechanism_section: 'default',
    proof_section:     'dark',
    testimonials:      'alt',
    pricing_block:     'default',
    faq:               'alt',
    cta_block:         'primary',   // high-contrast CTA band
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// lp-short-offer-rtl
// Short single-offer page. Minimal friction, fast path to conversion.
// Use when: warm traffic, simple offer, retargeting audience, strong single CTA.
// ─────────────────────────────────────────────────────────────────────────────
const LP_SHORT_OFFER_RTL = Object.freeze({
  id:          'lp-short-offer-rtl',
  name:        'דף הצעה קצר (RTL)',
  description: 'דף קצר ממוקד. פחות סקשנים, פחות חיכוך, מתאים לתנועה חמה, רטרגטינג, והצעה בודדת.',
  asset_types: ['landing_page_html'],

  allowed_components: [
    'hero',
    'stats_row',
    'proof_section',
    'pricing_block',
    'lead_form',
    'cta_block',
    'testimonials',
  ],

  required_components: ['hero', 'cta_block'],

  default_order: [
    'hero',               // above fold — hero + CTA
    'stats_row',          // quick credibility
    'proof_section',      // 2–3 proof items max
    'testimonials',       // 1–2 testimonials max
    'pricing_block',      // or lead_form
    'cta_block',          // final CTA
  ],

  mobile_rules: {
    breakpoint:           'md',
    hero_image_position:  'below-text',
    nav:                  'none',
    cta_width_mobile:     '100%',
    sticky_cta:           true,
    sections_padding_x:   '16px',
    max_sections_mobile:  4,        // aggressively short on mobile
  },

  rtl: {
    dir:        'rtl',
    lang:       'he',
    text_align: 'right',
    split_image_side: 'end',
  },

  layout_constraints: {
    max_width:      '768px',        // narrow — keeps attention on offer
    container:      'narrow',
    section_padding_y:    '56px',
    section_padding_y_sm: '40px',
    no_nav:         true,
    no_footer_links: true,
    hero_min_height: '50vh',        // shorter hero — fast path
    max_total_sections: 5,          // hard cap — short page stays short
  },

  section_strategy: {
    pain_before_mechanism: false,   // skip pain — warm traffic already knows the problem
    proof_after_mechanism: false,   // minimal proof — just enough to remove last doubt
    cta_count:             'single',
    faq_before_final_cta:  false,   // no FAQ — too much friction on short pages
    testimonials_placement: 'before-cta',
    conversion_component:  'goal-dependent',
  },

  section_backgrounds: {
    hero:          'default',
    stats_row:     'muted',
    proof_section: 'dark',
    testimonials:  'alt',
    pricing_block: 'default',
    cta_block:     'primary',
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// banner-basic-rtl
// HTML banner ad in standard display sizes.
// Use when: generating a display ad HTML file for Google Display / programmatic.
// ─────────────────────────────────────────────────────────────────────────────
const BANNER_BASIC_RTL = Object.freeze({
  id:          'banner-basic-rtl',
  name:        'באנר פרסומי (RTL)',
  description: 'קובץ HTML לבאנר פרסומי בפורמטים סטנדרטיים. מסר אחד, לוגו, CTA. לא לחשוף טקסט מרובה.',
  asset_types: ['banner_html'],

  allowed_components: ['banner_strip'],  // banner is a single-component asset
  required_components: ['banner_strip'],

  default_order: ['banner_strip'],

  // Banner sizes to support — composer generates one HTML per size
  sizes: [
    { id: 'leaderboard', width: 728, height: 90,  label: 'Leaderboard' },
    { id: 'rectangle',   width: 300, height: 250, label: 'Medium Rectangle' },
    { id: 'skyscraper',  width: 160, height: 600, label: 'Wide Skyscraper' },
    { id: 'billboard',   width: 970, height: 250, label: 'Billboard' },
    { id: 'square',      width: 250, height: 250, label: 'Square' },
  ],

  mobile_rules: {
    breakpoint: null,   // banners are fixed-size — no responsive behavior
    scale_safe: true,   // CSS scale() allowed for device pixel ratio adjustment
  },

  rtl: {
    dir:        'rtl',
    lang:       'he',
    text_align: 'right',
  },

  layout_constraints: {
    max_text_chars:      80,        // banners must be brief
    single_cta:          true,      // one CTA only
    no_scroll:           true,      // banners never scroll
    no_forms:            true,      // no forms in banners
    animation_allowed:   false,     // static only for initial version
    must_have_logo_slot: true,      // brand recognition is primary goal
    must_have_cta:       true,
  },

  section_strategy: {
    pain_before_mechanism: false,
    single_message:        true,    // one message only — clarity over completeness
  },

  section_backgrounds: {
    banner_strip: 'primary',
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// ad-html-card-rtl
// Standalone HTML ad card. Square or portrait format.
// Use when: social ad HTML, email ad block, embedded ad unit.
// ─────────────────────────────────────────────────────────────────────────────
const AD_HTML_CARD_RTL = Object.freeze({
  id:          'ad-html-card-rtl',
  name:        'כרטיס מודעה HTML (RTL)',
  description: 'מודעה בפורמט כרטיס HTML — ריבועי או פורטרט. לשימוש כ-embed, מייל, או יחידת פרסום.',
  asset_types: ['ad_html', 'offer_card_html'],

  allowed_components: [
    'hero',          // hero in minimal/text-only variant
    'cta_block',     // single action
    'stats_row',     // optional quick proof
  ],

  required_components: ['hero', 'cta_block'],

  default_order: [
    'hero',          // headline + image slot
    'stats_row',     // optional: 1–2 proof numbers
    'cta_block',     // CTA button
  ],

  // Supported ad card formats
  formats: [
    { id: 'square',   width: 1080, height: 1080, label: '1:1 Feed' },
    { id: 'portrait', width: 1080, height: 1350, label: '4:5 Feed' },
    { id: 'story',    width: 1080, height: 1920, label: '9:16 Story' },
  ],

  mobile_rules: {
    breakpoint:    null,          // fixed dimensions, no responsive
    font_scale:    'viewport',    // use vw units for type to scale with card size
  },

  rtl: {
    dir:        'rtl',
    lang:       'he',
    text_align: 'right',
  },

  layout_constraints: {
    max_text_overlay_pct: 0.20,   // text covers max 20% of image area (Meta rule)
    no_nav:               true,
    no_forms:             true,
    no_scroll:            true,
    must_have_cta:        true,
    image_slot_required:  true,   // ad cards always have an image slot
    hero_variant:         'text-only or split', // no carousel in card format
  },

  section_strategy: {
    pain_before_mechanism: false,
    single_message:        true,
    cta_count:             'single',
  },

  section_backgrounds: {
    hero:      'image',     // background is the image slot
    cta_block: 'overlay',   // CTA overlays the image or sits below
  },
});

// ── Template Registry ─────────────────────────────────────────────────────────
// Maps template id → definition. Used by Blueprint Builder for template selection.

const TEMPLATES = Object.freeze({
  'lp-conversion-rtl':  LP_CONVERSION_RTL,
  'lp-short-offer-rtl': LP_SHORT_OFFER_RTL,
  'banner-basic-rtl':   BANNER_BASIC_RTL,
  'ad-html-card-rtl':   AD_HTML_CARD_RTL,
});

// ── Template selection helper ─────────────────────────────────────────────────

/**
 * selectTemplate(assetType, options)
 * Returns the most appropriate template for a given asset type and goal.
 *
 * @param {string} assetType — e.g. 'landing_page_html', 'banner_html', 'ad_html'
 * @param {object} options   — { goal?, traffic_temperature?, length? }
 *   goal:                'lead_generation' | 'direct_sale' | 'awareness'
 *   traffic_temperature: 'cold' | 'warm' | 'hot'
 *   length:              'short' | 'long'
 * @returns {object|null}  — template definition or null if no match
 */
function selectTemplate(assetType, options = {}) {
  const { goal, traffic_temperature, length } = options;

  if (assetType === 'banner_html') {
    return TEMPLATES['banner-basic-rtl'];
  }

  if (assetType === 'ad_html' || assetType === 'offer_card_html') {
    return TEMPLATES['ad-html-card-rtl'];
  }

  if (assetType === 'landing_page_html') {
    // Short page: warm/hot traffic, or explicit short preference
    const isShort =
      length === 'short' ||
      traffic_temperature === 'warm' ||
      traffic_temperature === 'hot';

    return isShort
      ? TEMPLATES['lp-short-offer-rtl']
      : TEMPLATES['lp-conversion-rtl'];
  }

  return null;
}

/**
 * getTemplateById(id)
 * Direct lookup by template id.
 */
function getTemplateById(id) {
  return TEMPLATES[id] || null;
}

module.exports = {
  TEMPLATES,
  LP_CONVERSION_RTL,
  LP_SHORT_OFFER_RTL,
  BANNER_BASIC_RTL,
  AD_HTML_CARD_RTL,
  selectTemplate,
  getTemplateById,
};
