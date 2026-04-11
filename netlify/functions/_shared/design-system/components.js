'use strict';

/**
 * design-system/components.js — Component Schemas
 *
 * Defines the contract for every reusable marketing component.
 * This is NOT HTML. It is the schema that the HTML Composer uses to:
 *   1. Validate incoming props
 *   2. Know what each component needs vs. what is optional
 *   3. Apply correct layout intent and constraints
 *
 * The HTML Composer reads these schemas and renders the actual markup.
 *
 * Schema per component:
 *   type          — unique string identifier
 *   description   — what this component does on a page
 *   layout_intent — how it behaves structurally (width, position, role)
 *   required      — props that must be present; composer throws if missing
 *   optional      — props that enhance rendering when present
 *   variants      — named layout variants the composer supports
 *   constraints   — hard rules the composer must enforce
 *   defaults      — fallback values for optional props
 */

// ── Helper: freeze nested ────────────────────────────────────────────────────
const schema = (def) => Object.freeze(def);

// ── Component Schemas ─────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// HERO
// Above-the-fold section. Highest-priority component on any conversion page.
// ─────────────────────────────────────────────────────────────────────────────
const HERO = schema({
  type:        'hero',
  description: 'Above-the-fold opener. Must communicate the core promise within 2 seconds. Highest visual hierarchy.',
  layout_intent: {
    width:      'full',          // always edge-to-edge
    position:   'first',         // always first component on page
    min_height: '60vh',          // ensures visibility above fold on most screens
    role:       'conversion-critical',
  },
  required: [
    'headline',                  // main message — 5–10 words max for Hebrew
    'cta_text',                  // button label
    'cta_href',                  // button destination
  ],
  optional: [
    'subheadline',               // supporting message below headline
    'image_slot',                // visual area (placeholder or URL)
    'image_alt',                 // alt text for image
    'badge_text',                // small trust badge above headline ("ללא סיכון", "+500 לקוחות")
    'trust_line',                // single trust indicator below CTA
    'secondary_cta_text',        // second button (less prominent)
    'secondary_cta_href',
    'background_color',          // overrides default bg
    'background_image_slot',     // full-bleed background image
    'overlay_opacity',           // if background image: darken overlay (0–1)
    'text_color_override',       // 'light' | 'dark' — for dark bg heroes
  ],
  variants: [
    'centered',                  // headline + CTA centered, image below or behind
    'split-image-start',         // text on end side, image on start side (RTL: text=left)
    'split-image-end',           // text on start side, image on end side (RTL: text=right)
    'text-only',                 // no image — copy and CTA only
    'dark',                      // dark background variant
    'video-bg',                  // video background slot
  ],
  constraints: {
    headline_max_words:   12,    // Hebrew headlines over 12 words lose impact
    cta_text_max_chars:   20,    // button label must fit on one line
    must_have_cta:        true,  // composer must always render the CTA button
    mobile_image:         'below-text', // on mobile: image always goes below text
  },
  defaults: {
    variant:            'centered',
    background_color:   'semantic.bg_base',
    text_color_override: 'dark',
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// CTA BLOCK
// Standalone call-to-action section. Used mid-page and end-of-page.
// ─────────────────────────────────────────────────────────────────────────────
const CTA_BLOCK = schema({
  type:        'cta_block',
  description: 'Standalone CTA section. Drives the primary action. Can appear multiple times on a page.',
  layout_intent: {
    width:    'full',
    position: 'mid-page or final',
    role:     'conversion-action',
  },
  required: [
    'headline',
    'button_text',
    'button_href',
  ],
  optional: [
    'subtext',                   // short supporting copy under headline
    'urgency_text',              // "נותרו 3 מקומות", "מחיר מוגבל"
    'guarantee_text',            // "ללא סיכון", "החזר כסף"
    'background_color',
    'button_variant',            // maps to BUTTONS.variants
    'button_size',               // maps to BUTTONS.sizes
  ],
  variants: [
    'centered',                  // standard centered block
    'inline',                    // headline + button side by side
    'full-bleed',                // high-contrast full-width band
    'sticky-bottom',             // fixed to bottom of viewport on mobile
  ],
  constraints: {
    button_text_max_chars: 25,
    must_have_cta: true,
  },
  defaults: {
    variant:        'centered',
    button_variant: 'primary',
    button_size:    'xl',
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// PAIN SECTION
// Activates the emotional trigger. Shows the audience their own problem.
// ─────────────────────────────────────────────────────────────────────────────
const PAIN_SECTION = schema({
  type:        'pain_section',
  description: 'Makes the audience feel seen by naming their problem precisely. Activates emotional motivation.',
  layout_intent: {
    width:    'contained',       // max-width container
    position: 'early',          // appears before mechanism — establishes WHY
    role:     'emotional-trigger',
  },
  required: [
    'headline',                  // "מכיר את התחושה הזאת?"
    'pain_points',               // array of strings — each is a named pain
  ],
  optional: [
    'body_text',                 // optional expanded description
    'image_slot',                // visual reinforcing the pain
    'image_alt',
    'conclusion_text',           // bridge to solution: "יש דרך אחרת"
    'background_color',
    'icon_style',                // 'check' | 'x' | 'dot' | 'emoji' — for pain list items
  ],
  variants: [
    'checklist',                 // pain_points as a visual list with icons
    'cards',                     // each pain as a card
    'image-left',                // pain image on start side (RTL: right)
    'text-dominant',             // no image, typography-heavy
  ],
  constraints: {
    pain_points_max:  7,         // more than 7 items loses focus
    pain_points_min:  2,
  },
  defaults: {
    variant:     'checklist',
    icon_style:  'x',
    background_color: 'semantic.bg_subtle',
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// MECHANISM SECTION
// Shows HOW the product works. Builds trust through specificity.
// ─────────────────────────────────────────────────────────────────────────────
const MECHANISM_SECTION = schema({
  type:        'mechanism_section',
  description: 'Explains the unique mechanism or method. Answers: "why does this work when other things didn\'t?"',
  layout_intent: {
    width:    'contained',
    position: 'after-pain',     // comes after pain section
    role:     'trust-through-specificity',
  },
  required: [
    'headline',
    'steps',                     // array of { title, description } — 2–5 steps
  ],
  optional: [
    'subheadline',
    'image_slot',
    'image_alt',
    'mechanism_name',            // named framework: "שיטת ה-3F"
    'icon_slots',                // array of icon identifiers, one per step
    'background_color',
  ],
  variants: [
    'numbered-steps',            // 1, 2, 3 sequential flow
    'cards',                     // each step as a card
    'timeline',                  // visual timeline
    'split',                     // steps on one side, image on other
  ],
  constraints: {
    steps_min: 2,
    steps_max: 5,
    step_description_max_chars: 120,
  },
  defaults: {
    variant: 'numbered-steps',
    background_color: 'semantic.bg_base',
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// PROOF SECTION
// Removes skepticism with evidence. Results, numbers, before/after.
// ─────────────────────────────────────────────────────────────────────────────
const PROOF_SECTION = schema({
  type:        'proof_section',
  description: 'Shows measurable evidence that the promise is real. Numbers and specifics beat vague claims.',
  layout_intent: {
    width:    'contained',
    position: 'after-mechanism',
    role:     'credibility',
  },
  required: [
    'headline',
    'proof_items',               // array of { label, value, context? }
                                 // e.g. { label: 'לידים ממוצע', value: '100+', context: 'בחודש הראשון' }
  ],
  optional: [
    'subheadline',
    'image_slots',               // result images, before/after
    'stats_row',                 // array of { number, label } for prominent stats
    'background_color',
    'cta_text',                  // optional CTA within proof section
    'cta_href',
  ],
  variants: [
    'stat-focused',              // large numbers, minimal text
    'testimonial-focused',       // quotes with names
    'before-after',              // split visual comparison
    'mixed',                     // numbers + quotes combined
  ],
  constraints: {
    proof_items_min: 1,
    proof_items_max: 6,
    specificity_required: true,  // validator rejects vague items like "תוצאות מדהימות"
  },
  defaults: {
    variant: 'stat-focused',
    background_color: 'semantic.bg_dark',
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// TESTIMONIALS
// Social proof from real people. Reduces risk perception.
// ─────────────────────────────────────────────────────────────────────────────
const TESTIMONIALS = schema({
  type:        'testimonials',
  description: 'Real customer voices. Reduces perceived risk and validates the promise.',
  layout_intent: {
    width:    'contained',
    position: 'after-proof or near-cta',
    role:     'social-proof',
  },
  required: [
    'testimonials',              // array of { quote, name, result? }
                                 // result: "100 לידים בחודש הראשון"
  ],
  optional: [
    'headline',
    'avatar_slots',              // array of image slots (one per testimonial)
    'company',                   // company name per testimonial
    'rating',                    // star rating per testimonial (1–5)
    'background_color',
  ],
  variants: [
    'single-featured',           // one large prominent testimonial
    'grid-2',                    // two columns
    'grid-3',                    // three columns
    'logo-wall',                 // just logos, no quotes
  ],
  constraints: {
    testimonials_min:  1,
    testimonials_max:  6,
    quote_max_chars:   200,      // longer quotes lose attention in RTL layout
    names_required:    true,     // anonymous testimonials have low trust
  },
  defaults: {
    variant: 'grid-2',
    background_color: 'semantic.bg_subtle',
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// FAQ
// Pre-empts objections. Answers the questions that block the purchase.
// ─────────────────────────────────────────────────────────────────────────────
const FAQ = schema({
  type:        'faq',
  description: 'Handles objections and hesitations. Should address the most common reasons not to buy.',
  layout_intent: {
    width:    'narrow',          // FAQ is easier to read in narrow column
    position: 'before-final-cta',
    role:     'objection-handling',
  },
  required: [
    'questions',                 // array of { question, answer }
  ],
  optional: [
    'headline',                  // default: "שאלות נפוצות"
    'background_color',
  ],
  variants: [
    'accordion',                 // expandable items
    'stacked',                   // all open, stacked
    'two-column',                // split into 2 columns at desktop
  ],
  constraints: {
    questions_min: 2,
    questions_max: 10,
    answer_max_chars: 300,
  },
  defaults: {
    headline: 'שאלות נפוצות',
    variant:  'accordion',
    background_color: 'semantic.bg_base',
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// PRICING BLOCK
// Decision point. Shows price with context. Converts consideration to action.
// ─────────────────────────────────────────────────────────────────────────────
const PRICING_BLOCK = schema({
  type:        'pricing_block',
  description: 'Presents the offer price with supporting context. Must reduce price anxiety and frame value.',
  layout_intent: {
    width:    'contained',
    position: 'late-page or primary offer',
    role:     'conversion-decision',
  },
  required: [
    'plans',                     // array of { name, price, period?, features[], cta_text, cta_href }
  ],
  optional: [
    'headline',
    'subheadline',
    'highlighted_plan',          // plan name to emphasize (e.g. "most popular")
    'guarantee_text',            // "ערבות להחזר כסף 30 יום"
    'original_price',            // crossed-out original price for anchoring
    'urgency_text',
    'background_color',
  ],
  variants: [
    'single',                    // one offer card (most conversion-focused)
    'comparison-2',              // two plan comparison
    'comparison-3',              // three plan comparison
    'simple-offer',              // plain price display, minimal chrome
  ],
  constraints: {
    plans_max:          3,       // more than 3 plans create decision paralysis
    features_max:       8,       // per plan
    price_required:     true,
  },
  defaults: {
    variant: 'single',
    background_color: 'semantic.bg_base',
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// STATS ROW
// Authority through numbers. Compact proof block.
// ─────────────────────────────────────────────────────────────────────────────
const STATS_ROW = schema({
  type:        'stats_row',
  description: 'Compact row of key numbers. Builds authority quickly. Best placed after hero or in proof sections.',
  layout_intent: {
    width:    'full',
    position: 'flexible — after hero or standalone',
    role:     'authority-signal',
  },
  required: [
    'stats',                     // array of { number, label }
                                 // e.g. { number: '500+', label: 'לקוחות מרוצים' }
  ],
  optional: [
    'headline',
    'background_color',
    'icon_slots',                // one icon per stat (optional visual accent)
  ],
  variants: [
    'inline',                    // horizontal row
    'cards',                     // each stat in its own card
    'prominent',                 // very large numbers, full section
  ],
  constraints: {
    stats_min: 2,
    stats_max: 5,
    number_specificity: true,    // "500+" not "הרבה לקוחות"
  },
  defaults: {
    variant: 'inline',
    background_color: 'semantic.bg_muted',
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// LEAD FORM
// Primary conversion element. Captures contact info.
// ─────────────────────────────────────────────────────────────────────────────
const LEAD_FORM = schema({
  type:        'lead_form',
  description: 'Contact/lead capture form. The primary conversion element for lead-generation pages.',
  layout_intent: {
    width:    'narrow',
    position: 'above-fold for lead-first pages, or after proof',
    role:     'primary-conversion',
  },
  required: [
    'headline',
    'fields',                    // array of { type, name, label, placeholder, required }
                                 // types: 'text' | 'email' | 'tel' | 'select' | 'textarea'
    'submit_text',               // button label
  ],
  optional: [
    'subtext',                   // short copy above form
    'privacy_note',              // "לא נשלח ספאם. לעולם."
    'background_color',
    'success_message',           // shown after successful submit
    'form_action',               // POST target URL or JS handler
  ],
  variants: [
    'minimal',                   // name + phone/email + submit only
    'full',                      // multiple fields
    'two-column',                // fields in 2 columns at desktop
    'floating',                  // fixed position on desktop (scrolls with user)
  ],
  constraints: {
    fields_min:      1,
    fields_max:      6,          // more fields = lower conversion
    submit_text_max: 25,
    tel_field_format: 'israeli', // validates Israeli phone format
  },
  defaults: {
    variant: 'minimal',
    submit_text: 'שלח לי פרטים',
    background_color: 'semantic.primary_light',
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// BANNER STRIP
// Thin announcement or persistent CTA bar.
// ─────────────────────────────────────────────────────────────────────────────
const BANNER_STRIP = schema({
  type:        'banner_strip',
  description: 'Thin strip for announcements, urgency, or persistent CTA. One message only.',
  layout_intent: {
    width:    'full',
    position: 'top of page or bottom sticky',
    role:     'attention-capture or persistent-cta',
  },
  required: [
    'text',
    'cta_text',
    'cta_href',
  ],
  optional: [
    'background_color',
    'icon_slot',
    'urgency_flag',              // boolean — adds countdown visual treatment
    'dismissible',               // boolean — adds close button
  ],
  variants: [
    'top-fixed',                 // sticky to top of viewport
    'bottom-fixed',              // sticky to bottom of viewport
    'inline',                    // static within page flow
  ],
  constraints: {
    text_max_chars: 80,          // strip is narrow — keep it short
    cta_text_max:   20,
    single_cta:     true,        // one CTA only — no competing actions
  },
  defaults: {
    variant: 'top-fixed',
    background_color: 'semantic.primary',
    dismissible: false,
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// FEATURE CARDS
// Shows value proposition components. Multiple benefits, scannable.
// ─────────────────────────────────────────────────────────────────────────────
const FEATURE_CARDS = schema({
  type:        'feature_cards',
  description: 'Grid of features or benefits. Breaks down the value proposition into scannable units.',
  layout_intent: {
    width:    'contained',
    position: 'flexible — after hero or after mechanism',
    role:     'value-expansion',
  },
  required: [
    'features',                  // array of { title, description }
  ],
  optional: [
    'headline',
    'icon_slots',                // one icon per feature (SVG or emoji)
    'image_slots',               // one image per feature (heavier variant)
    'background_color',
  ],
  variants: [
    'grid-2',                    // 2 columns
    'grid-3',                    // 3 columns
    'horizontal-list',           // icon + text horizontal
    'icon-heavy',                // icon prominent, text secondary
  ],
  constraints: {
    features_min: 2,
    features_max: 8,
    title_max_chars:       40,
    description_max_chars: 100,
  },
  defaults: {
    variant: 'grid-3',
    background_color: 'semantic.bg_subtle',
  },
});

// ── Component Registry ────────────────────────────────────────────────────────
// Maps type string → schema. Used by Blueprint Builder and Composer for lookups.

const COMPONENTS = Object.freeze({
  hero:              HERO,
  cta_block:         CTA_BLOCK,
  pain_section:      PAIN_SECTION,
  mechanism_section: MECHANISM_SECTION,
  proof_section:     PROOF_SECTION,
  testimonials:      TESTIMONIALS,
  faq:               FAQ,
  pricing_block:     PRICING_BLOCK,
  stats_row:         STATS_ROW,
  lead_form:         LEAD_FORM,
  banner_strip:      BANNER_STRIP,
  feature_cards:     FEATURE_CARDS,
});

// ── Validation helper ─────────────────────────────────────────────────────────

/**
 * validateComponentProps(type, props)
 * Returns { valid: true } or { valid: false, missing: [...], errors: [...] }
 * Used by the Blueprint Builder before passing to Composer.
 */
function validateComponentProps(type, props = {}) {
  const schema = COMPONENTS[type];
  if (!schema) {
    return { valid: false, missing: [], errors: [`Unknown component type: "${type}"`] };
  }

  const missing = schema.required.filter((key) => {
    const val = props[key];
    if (val === undefined || val === null) return true;
    if (typeof val === 'string' && val.trim() === '') return true;
    if (Array.isArray(val) && val.length === 0) return true;
    return false;
  });

  if (missing.length > 0) {
    return {
      valid:  false,
      missing,
      errors: missing.map((k) => `Component "${type}" is missing required prop: "${k}"`),
    };
  }

  return { valid: true, missing: [], errors: [] };
}

module.exports = {
  COMPONENTS,
  HERO,
  CTA_BLOCK,
  PAIN_SECTION,
  MECHANISM_SECTION,
  PROOF_SECTION,
  TESTIMONIALS,
  FAQ,
  PRICING_BLOCK,
  STATS_ROW,
  LEAD_FORM,
  BANNER_STRIP,
  FEATURE_CARDS,
  validateComponentProps,
};
