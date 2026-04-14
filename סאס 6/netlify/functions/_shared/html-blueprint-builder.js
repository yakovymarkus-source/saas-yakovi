'use strict';

/**
 * html-blueprint-builder.js — HTML Blueprint Builder
 *
 * Translates a LandingStructure (from landing-structure-engine) into a fully
 * resolved HTMLBlueprint that the HTML Composer can render directly to markup.
 *
 * This module produces NO HTML. It is a pure data transformation layer:
 *   LandingStructure + DesignSystem + (optional) Memory → HTMLBlueprint
 *
 * Responsibilities:
 *   1. Resolve the correct template from the design system
 *   2. For each section: populate props (from memory via content generator)
 *   3. For each section: resolve layout (from template constraints + component schema)
 *   4. Validate props against component schema — flag missing required fields
 *   5. Assemble a complete, ordered, RTL-aware blueprint object
 *
 * The HTML Composer reads this blueprint and writes markup — nothing else.
 *
 * Usage:
 *   const blueprint = buildHTMLBlueprint(structure, designSystem, memory);
 *
 * @param {LandingStructure} structure   — from buildLandingStructure()
 * @param {DesignSystem}     designSystem — { tokens, components, templates } object
 *                                          Pass null/undefined to use built-in defaults.
 * @param {MarketingMemory}  memory      — optional; from buildMarketingMemory().
 *                                          When provided, content is auto-generated.
 *                                          When absent, props come only from structure hints.
 */

// ── Design system imports (defaults — overridden by caller's designSystem arg) ─

const DEFAULT_TOKENS     = require('./design-system/tokens');
const DEFAULT_COMPONENTS = require('./design-system/components');
const DEFAULT_TEMPLATES  = require('./design-system/templates');

// ── Content generator ─────────────────────────────────────────────────────────
const { buildSectionContent } = require('./section-content-generator');

// ── Background token → resolved hex color ─────────────────────────────────────
// Maps section_backgrounds token names to semantic color values.
// Sourced from COLORS.semantic in tokens.js — kept in sync manually.

const BG_COLOR_MAP = Object.freeze({
  default: '#ffffff',    // semantic.bg_base
  alt:     '#f9fafb',    // semantic.bg_subtle
  muted:   '#f3f4f6',    // semantic.bg_muted
  dark:    '#111827',    // semantic.bg_dark
  primary: '#1a56db',    // semantic.primary
  image:   null,         // background is an image slot — no color
  overlay: null,         // overlay on top of image
});

// ── Container width → CSS value ───────────────────────────────────────────────
// Maps template layout_constraints.container tokens to pixel values.

const CONTAINER_WIDTH_MAP = Object.freeze({
  narrow: '640px',
  base:   '768px',
  wide:   '1024px',
  full:   '1280px',
  flush:  '100%',
});

// ── Component width → Tailwind-style class hint ───────────────────────────────
// Tells the composer how to constrain the section container.

const LAYOUT_WIDTH_CLASS = Object.freeze({
  full:      'w-full',       // edge-to-edge — hero, cta_block, banner
  contained: 'container',   // max-width constrained, centered
  narrow:    'container-narrow', // narrow column — forms, FAQ
});

// ─────────────────────────────────────────────────────────────────────────────
// buildHTMLBlueprint — main export
// ─────────────────────────────────────────────────────────────────────────────

function buildHTMLBlueprint(structure, designSystem, memory) {

  // ── Resolve design system ─────────────────────────────────────────────────
  const ds = {
    tokens:     (designSystem && designSystem.tokens)     || DEFAULT_TOKENS,
    components: (designSystem && designSystem.components) || DEFAULT_COMPONENTS,
    templates:  (designSystem && designSystem.templates)  || DEFAULT_TEMPLATES,
  };

  const { COLORS, SPACING, TYPOGRAPHY, RTL: RTL_CONFIG } = ds.tokens;
  const { COMPONENTS, validateComponentProps } = ds.components;
  const { getTemplateById, selectTemplate }    = ds.templates;

  // ── Validate structure ────────────────────────────────────────────────────
  if (!structure || !Array.isArray(structure.sections)) {
    throw new Error('buildHTMLBlueprint: structure must have a sections array');
  }

  const { sections, cta_strategy, hierarchy } = structure;

  // ── Resolve template ──────────────────────────────────────────────────────
  const templateId = hierarchy?.template_id || 'lp-conversion-rtl';
  const template   = getTemplateById(templateId) || getTemplateById('lp-conversion-rtl');

  if (!template) {
    throw new Error(`buildHTMLBlueprint: template "${templateId}" not found in design system`);
  }

  // ── Page-level layout constants ───────────────────────────────────────────
  // Resolved once and applied to every section.

  const templateConstraints = template.layout_constraints || {};
  const templateMobileRules = template.mobile_rules       || {};
  const templateRtl         = template.rtl                || RTL_CONFIG;
  const sectionBackgrounds  = template.section_backgrounds || {};

  const pageMaxWidth = templateConstraints.max_width       || '1280px';
  const sectionPadY  = templateConstraints.section_padding_y    || `${SPACING.section_y}px`;
  const sectionPadYSm = templateConstraints.section_padding_y_sm || `${SPACING.section_y_sm}px`;
  const containerType = templateConstraints.container     || 'wide';
  const containerWidth = CONTAINER_WIDTH_MAP[containerType] || pageMaxWidth;

  // ── Build page meta ───────────────────────────────────────────────────────
  const meta = _buildMeta({
    template,
    hierarchy,
    RTL_CONFIG: templateRtl,
    TYPOGRAPHY,
    pageMaxWidth,
    containerWidth,
    templateConstraints,
    templateMobileRules,
  });

  // ── Build components ──────────────────────────────────────────────────────
  const components = sections.map((section) =>
    _buildComponentBlueprint({
      section,
      template,
      templateConstraints,
      templateMobileRules,
      templateRtl,
      sectionBackgrounds,
      sectionPadY,
      sectionPadYSm,
      containerWidth,
      pageMaxWidth,
      COMPONENTS,
      validateComponentProps,
      memory,
    })
  );

  // ── Assemble and return ───────────────────────────────────────────────────
  return {
    template_id:   template.id,
    template_name: template.name,
    meta,
    cta_strategy:  cta_strategy || null,
    components,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// _buildMeta — assemble page-level metadata block
// ─────────────────────────────────────────────────────────────────────────────
function _buildMeta({
  template, hierarchy, RTL_CONFIG, TYPOGRAPHY,
  pageMaxWidth, containerWidth, templateConstraints, templateMobileRules,
}) {
  return {
    // Document
    lang:            RTL_CONFIG.lang       || 'he',
    dir:             RTL_CONFIG.dir        || 'rtl',
    charset:         'UTF-8',
    viewport:        'width=device-width, initial-scale=1.0',

    // Fonts — Hebrew-safe Google Fonts URL
    google_fonts_url: RTL_CONFIG.googleFontsUrl || null,
    font_family_display: TYPOGRAPHY.fontFamily.display,
    font_family_body:    TYPOGRAPHY.fontFamily.body,

    // Layout
    page_max_width:  pageMaxWidth,
    container_width: containerWidth,
    mobile_first:    true,
    breakpoint_md:   templateMobileRules.breakpoint || 'md',   // single-col below this
    sections_padding_x_mobile: templateMobileRules.sections_padding_x || '16px',

    // Template rules
    no_nav:          templateConstraints.no_nav          || false,
    no_footer_links: templateConstraints.no_footer_links || false,
    no_horizontal_scroll: templateConstraints.no_horizontal_scroll || true,

    // Content summary
    page_length:        hierarchy?.page_length        || 'long',
    traffic_temperature: hierarchy?.traffic_temperature || 'cold',
    primary_goal:       hierarchy?.primary_goal        || null,
    total_sections:     hierarchy?.section_count       || 0,
    template_id:        template.id,
    rtl:                true,

    // Mobile sticky CTA
    sticky_cta_mobile: templateMobileRules.sticky_cta || false,
    cta_width_mobile:  templateMobileRules.cta_width_mobile || '100%',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// _buildComponentBlueprint — build one component entry
// ─────────────────────────────────────────────────────────────────────────────
function _buildComponentBlueprint({
  section,
  template,
  templateConstraints,
  templateMobileRules,
  templateRtl,
  sectionBackgrounds,
  sectionPadY,
  sectionPadYSm,
  containerWidth,
  pageMaxWidth,
  COMPONENTS,
  validateComponentProps,
  memory,
}) {
  const sectionId = section.id;

  // ── 1. Get component schema ──────────────────────────────────────────────
  const componentSchema = COMPONENTS[sectionId] || null;

  // ── 2. Resolve props ─────────────────────────────────────────────────────
  // Priority: memory-derived content → component_hint from structure → empty
  let props = {};

  if (memory) {
    try {
      // buildSectionContent returns real content from memory
      const generated = buildSectionContent(sectionId, memory);
      props = _mergeProps(generated, section.component_hint);
    } catch (_) {
      // Section type might not be supported by content generator — use hint only
      props = { ...section.component_hint };
    }
  } else {
    // No memory: use component_hint as sparse props
    // Composer will render placeholders for missing required fields
    props = { ...section.component_hint };
  }

  // ── 3. Validate props against schema ─────────────────────────────────────
  const validation = componentSchema
    ? validateComponentProps(sectionId, props)
    : { valid: true, missing: [], errors: [] };

  // ── 4. Resolve section background ────────────────────────────────────────
  // Priority: section.background (from structure engine) → template map → 'default'
  const bgToken = section.background
    || sectionBackgrounds[sectionId]
    || 'default';
  const bgColor = BG_COLOR_MAP[bgToken] ?? null;

  // ── 5. Resolve layout ────────────────────────────────────────────────────
  const layout = _buildLayout({
    section,
    componentSchema,
    template,
    templateConstraints,
    templateMobileRules,
    templateRtl,
    sectionPadY,
    sectionPadYSm,
    containerWidth,
    pageMaxWidth,
    bgToken,
    bgColor,
    props,
  });

  // ── 6. Assemble component blueprint ──────────────────────────────────────
  return {
    type:     sectionId,
    order:    section.order,
    purpose:  section.purpose,
    required: section.required,
    boosted:  section.boosted,
    props,
    layout,
    validation,
    // Content origin flag (aids debugging and placeholder rendering)
    content_source: memory ? 'memory' : 'hint-only',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// _buildLayout — resolve complete layout spec for one component
// ─────────────────────────────────────────────────────────────────────────────
function _buildLayout({
  section,
  componentSchema,
  template,
  templateConstraints,
  templateMobileRules,
  templateRtl,
  sectionPadY,
  sectionPadYSm,
  containerWidth,
  pageMaxWidth,
  bgToken,
  bgColor,
  props,
}) {
  const sectionId     = section.id;
  const layoutIntent  = componentSchema?.layout_intent || {};
  const hint          = section.component_hint || {};
  const constraints   = componentSchema?.constraints  || {};
  const defaults      = componentSchema?.defaults     || {};
  const variants      = componentSchema?.variants     || [];

  // ── Variant selection ─────────────────────────────────────────────────────
  // Priority: props._variant_hint (set by content generator) →
  //           component_hint.variant → component schema default
  const variant = _resolveVariant(
    props._variant_hint || hint.variant || defaults.variant,
    variants
  );

  // ── Width class ───────────────────────────────────────────────────────────
  const widthIntent    = layoutIntent.width || 'contained';
  const widthClass     = LAYOUT_WIDTH_CLASS[widthIntent] || LAYOUT_WIDTH_CLASS.contained;
  const effectiveWidth = widthIntent === 'full' ? pageMaxWidth : containerWidth;

  // ── Section padding ───────────────────────────────────────────────────────
  // banner_strip and stats_row use compact padding
  const isCompact = sectionId === 'banner_strip' || sectionId === 'stats_row';
  const padY      = isCompact ? sectionPadYSm : sectionPadY;
  const padYSm    = isCompact ? '24px'        : sectionPadYSm;

  // ── Mobile-specific rules ─────────────────────────────────────────────────
  const heroMinHeight      = hint.min_height || templateConstraints.hero_min_height || '60vh';
  const heroImagePosition  = templateMobileRules.hero_image_position || 'below-text';
  const ctaWidthMobile     = templateMobileRules.cta_width_mobile    || '100%';

  // ── Text direction ────────────────────────────────────────────────────────
  const dir       = templateRtl.dir        || 'rtl';
  const lang      = templateRtl.lang       || 'he';
  const textAlign = templateRtl.text_align || 'right';

  // ── Split layout image side (RTL: "end" = left) ───────────────────────────
  const splitImageSide = templateRtl.split_image_side || 'end';

  // ── CTA button spec ───────────────────────────────────────────────────────
  const ctaVariant = hint.cta_variant || defaults.button_variant || 'primary';
  const ctaSize    = hint.cta_size    || defaults.button_size    || 'xl';

  // ── Sticky CTA (mobile) — only for final cta_block ───────────────────────
  const isFinalCta = sectionId === 'cta_block' && section.purpose?.includes('final');
  const stickyCta  = isFinalCta && (templateMobileRules.sticky_cta || false);

  // ── Build layout object ───────────────────────────────────────────────────
  return {
    // Structure position
    order:           section.order,
    mobile_visible:  section.mobile_visible !== false,

    // Background
    background:       bgToken,
    background_color: bgColor,

    // Spacing
    section_padding_y:    padY,
    section_padding_y_sm: padYSm,
    sections_padding_x_mobile: templateMobileRules.sections_padding_x || '16px',

    // Width & container
    width_intent:    widthIntent,
    width_class:     widthClass,
    max_width:       effectiveWidth,
    container_type:  widthIntent === 'full' ? 'flush' : (widthIntent === 'narrow' ? 'narrow' : 'wide'),

    // Typography alignment (RTL)
    dir,
    lang,
    text_align:      textAlign,
    split_image_side: splitImageSide,

    // Component variant
    variant,

    // Role & purpose (aids composer decisions)
    role:     layoutIntent.role     || null,
    position: layoutIntent.position || null,

    // Component-specific
    ..._sectionSpecificLayout(sectionId, {
      hint, constraints, heroMinHeight, heroImagePosition,
      ctaWidthMobile, ctaVariant, ctaSize, stickyCta,
      section,
    }),

    // Constraints for composer to enforce
    constraints: _resolveConstraints(sectionId, constraints, hint),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// _sectionSpecificLayout — per-component extra layout rules
// ─────────────────────────────────────────────────────────────────────────────
function _sectionSpecificLayout(sectionId, {
  hint, constraints, heroMinHeight, heroImagePosition,
  ctaWidthMobile, ctaVariant, ctaSize, stickyCta,
  section,
}) {
  switch (sectionId) {
    case 'hero':
      return {
        min_height:           heroMinHeight,
        image_position_mobile: heroImagePosition,
        full_viewport:        hint.full_viewport || false,
        form_above_fold:      hint.form_above_fold || false,
        cta_variant:          ctaVariant,
        cta_size:             ctaSize,
        cta_width_mobile:     ctaWidthMobile,
      };

    case 'cta_block':
      return {
        sticky_mobile:    stickyCta,
        cta_variant:      ctaVariant,
        cta_size:         ctaSize,
        cta_width_mobile: ctaWidthMobile,
        is_final:         section.purpose?.includes('final') || false,
      };

    case 'lead_form':
      return {
        form_position:    hint.position     || 'default',
        max_fields:       hint.max_fields   || constraints.fields_max || 6,
        cta_variant:      ctaVariant,
        cta_width_mobile: ctaWidthMobile,
        tel_format:       'israeli',
      };

    case 'banner_strip':
      return {
        sticky:        hint.position === 'top-fixed' || true,
        include_timer: hint.include_timer || false,
        max_chars:     hint.max_chars || constraints.text_max_chars || 80,
      };

    case 'stats_row':
      return {
        layout:    hint.layout    || 'inline',
        max_stats: hint.max_stats || constraints.stats_max || 5,
      };

    case 'pain_section':
      return {
        icon_style:  hint.icon_style  || 'x',
        max_bullets: hint.max_bullets || constraints.pain_points_max || 7,
      };

    case 'mechanism_section':
      return {
        max_steps: hint.max_steps || constraints.steps_max || 5,
      };

    case 'proof_section':
      return {
        max_items: hint.max_items || constraints.proof_items_max || 6,
      };

    case 'testimonials':
      return {
        max_items:     hint.max_items     || constraints.testimonials_max || 6,
        require_names: constraints.names_required !== false,
      };

    case 'pricing_block':
      return {
        highlight_best_value: hint.highlight_best_value || false,
        max_features:         constraints.features_max  || 8,
      };

    case 'faq':
      return {
        layout:   hint.layout   || 'accordion',
        max_items: hint.max_items || constraints.questions_max || 10,
      };

    case 'feature_cards':
      return {
        max_items: hint.max_items || constraints.features_max || 8,
      };

    default:
      return {};
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// _resolveConstraints — gather hard rules for the HTML Composer to enforce
// ─────────────────────────────────────────────────────────────────────────────
function _resolveConstraints(sectionId, schemaConstraints, hint) {
  // Merge schema constraints with any overrides from structure hint
  const base = { ...schemaConstraints };

  // Section-specific overrides
  switch (sectionId) {
    case 'hero':
      return {
        ...base,
        headline_max_words:  base.headline_max_words || 12,
        cta_text_max_chars:  base.cta_text_max_chars || 20,
        must_have_cta:       true,
        mobile_image:        'below-text',
      };
    case 'lead_form':
      return {
        ...base,
        fields_max:          hint.max_fields || base.fields_max || 6,
        submit_text_max:     25,
        tel_field_format:    'israeli',
        must_have_cta:       true,
      };
    case 'banner_strip':
      return {
        ...base,
        text_max_chars: base.text_max_chars || 80,
        single_cta:     true,
      };
    case 'testimonials':
      return {
        ...base,
        names_required:  true,
        quote_max_chars: base.quote_max_chars || 200,
      };
    default:
      return base;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// _resolveVariant — validate and return variant, falling back to first allowed
// ─────────────────────────────────────────────────────────────────────────────
function _resolveVariant(requested, allowedVariants) {
  if (!allowedVariants || allowedVariants.length === 0) return requested || null;
  if (requested && allowedVariants.includes(requested)) return requested;
  // Fall back to first defined variant
  return allowedVariants[0] || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// _mergeProps — combine generated content with component_hint overrides
// component_hint props take precedence (structural decisions > content defaults)
// Private internal fields (prefixed _) are stripped before passing to composer
// ─────────────────────────────────────────────────────────────────────────────
function _mergeProps(generated, hint) {
  const base   = { ...generated };
  const overrides = { ...hint };

  // Apply hint overrides (hint drives layout decisions, not content)
  for (const [k, v] of Object.entries(overrides)) {
    if (v !== undefined && v !== null) base[k] = v;
  }

  return base;
}

// ─────────────────────────────────────────────────────────────────────────────
// Module exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = { buildHTMLBlueprint };
