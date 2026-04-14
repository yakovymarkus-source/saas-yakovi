'use strict';

/**
 * landing-structure-engine.js — Landing Page Structure Planner
 *
 * Determines the complete structural blueprint of a landing page or section
 * BEFORE any HTML is generated. The HTML Composer reads this output as its
 * sole structural specification — it never invents section order or placement.
 *
 * Inputs:
 *   memory      — MarketingMemory object from buildMarketingMemory()
 *   assetType   — 'landing_page_html' | 'landing_hero' | 'section_block'
 *   goal        — optional override (else uses memory.layout_preferences.primary_goal)
 *   funnelStage — optional override (else uses memory.current.funnel_stage)
 *
 * Output: LandingStructure
 *   {
 *     sections:     Section[],   — ordered list of sections with purpose + hints
 *     cta_strategy: CTAStrategy, — where CTAs go and how they should behave
 *     hierarchy:    Hierarchy,   — meta: template, page length, bottleneck, RTL
 *   }
 *
 * Rules:
 *   - Every structural decision traces to a memory field or an explicit default.
 *   - No hallucination. Missing signals → conservative, safe defaults.
 *   - Sections that require data are required: false — composer may omit them
 *     if the content generator has nothing to fill them with.
 *   - Pain section is skipped for warm/hot traffic (they already know the problem).
 *   - FAQ only appears when objections exist or conversion is the bottleneck.
 *   - Form above fold only fires for lead_generation goal + formAboveFold flag.
 */

// ── Supported asset types ─────────────────────────────────────────────────────

const SUPPORTED_ASSET_TYPES = new Set([
  'landing_page_html',
  'landing_hero',
  'section_block',
]);

// ── Bottleneck → structural emphasis ─────────────────────────────────────────
// When a bottleneck is identified, certain sections become the critical path.
// boost:  sections to flag as boosted (composer gives them more space/prominence)
// note:   human-readable reason (surfaced in hierarchy.bottleneck_note)

const BOTTLENECK_EMPHASIS = Object.freeze({
  ctr: {
    boost: ['hero', 'banner_strip'],
    note:  'CTR bottleneck: hero headline and hook are the critical path',
  },
  conversion: {
    boost: ['proof_section', 'testimonials', 'faq'],
    note:  'Conversion bottleneck: proof and objection-handling are the critical path',
  },
  roas: {
    boost: ['pricing_block', 'mechanism_section'],
    note:  'ROAS bottleneck: value clarity and price anchoring are the critical path',
  },
  quality: {
    boost: ['mechanism_section', 'proof_section'],
    note:  'Quality score bottleneck: relevance between ad and page needs improvement',
  },
  awareness: {
    boost: ['hero', 'stats_row'],
    note:  'Awareness bottleneck: authority signals and brand recognition come first',
  },
});

// ── Goal → conversion component ───────────────────────────────────────────────
// The component that closes the deal. Drives which section handles conversion.

const GOAL_CONVERSION_COMPONENT = Object.freeze({
  lead_generation: 'lead_form',
  direct_sale:     'pricing_block',
  consultation:    'lead_form',
  registration:    'lead_form',
  download:        'lead_form',
  awareness:       'cta_block',   // no form — just a click-through action
});

// ── Goal → section_block mapping ─────────────────────────────────────────────
// When asset type is section_block, map the goal to the most valuable single section.

const GOAL_TO_SECTION_BLOCK = Object.freeze({
  lead_generation: 'lead_form',
  direct_sale:     'pricing_block',
  consultation:    'lead_form',
  registration:    'lead_form',
  download:        'lead_form',
  awareness:       'proof_section',
});

// ── Traffic temperature resolver ──────────────────────────────────────────────
// Normalise arbitrary funnel stage strings to cold / warm / hot.
// This determines: skip pain?, urgency level, page length default.

function toTemperature(stage) {
  if (!stage) return 'cold';
  const s = stage.toLowerCase();
  if (/warm|retarget|return|engaged|interested/.test(s)) return 'warm';
  if (/hot|cart|checkout|decision|ready|purchase/.test(s)) return 'hot';
  return 'cold';
}

// ── Section factory ───────────────────────────────────────────────────────────
/**
 * makeSection(id, order, purpose, options)
 *
 * @param {string}   id            — component type (must match design-system/components.js keys)
 * @param {number}   order         — 1-indexed position in the page
 * @param {string}   purpose       — why this section exists (used by content generator)
 * @param {object}   options
 *   required        {boolean}  — must the composer include this section?
 *   background      {string}   — section background token: 'default'|'alt'|'muted'|'dark'|'primary'
 *   cta_here        {boolean}  — does a CTA live inside this section?
 *   mobile_visible  {boolean}  — render on mobile?
 *   boosted         {boolean}  — flagged as critical path by bottleneck analysis
 *   content_hints   {string[]} — memory field paths that feed this section's content
 *   component_hint  {object}   — composer guidance: variant, max_items, cta_variant, etc.
 */
function makeSection(id, order, purpose, {
  required       = false,
  background     = 'default',
  cta_here       = false,
  mobile_visible = true,
  boosted        = false,
  content_hints  = [],
  component_hint = {},
} = {}) {
  return Object.freeze({
    id,
    order,
    purpose,
    required,
    background,
    cta_here,
    mobile_visible,
    boosted,
    content_hints,
    component_hint,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// buildLandingStructure — main export
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {object}      memory      — MarketingMemory from buildMarketingMemory()
 * @param {string}      assetType   — 'landing_page_html' | 'landing_hero' | 'section_block'
 * @param {string|null} goal        — optional override
 * @param {string|null} funnelStage — optional override
 * @returns {LandingStructure}
 */
function buildLandingStructure(memory, assetType, goal = null, funnelStage = null) {

  if (!SUPPORTED_ASSET_TYPES.has(assetType)) {
    throw new Error(
      `buildLandingStructure: unsupported assetType "${assetType}". ` +
      `Supported: ${[...SUPPORTED_ASSET_TYPES].join(', ')}`
    );
  }

  const mem = memory || {};

  // ── Resolve goal ─────────────────────────────────────────────────────────
  // Priority: caller arg → memory.layout_preferences → memory.cta_preferences → fallback
  const resolvedGoal =
    goal ||
    mem.layout_preferences?.primary_goal ||
    mem.cta_preferences?.primary_goal ||
    'lead_generation';

  // ── Resolve funnel stage / temperature ───────────────────────────────────
  const resolvedStage = funnelStage || mem.current?.funnel_stage || null;
  const temperature   = toTemperature(resolvedStage);

  // ── Performance signals ───────────────────────────────────────────────────
  const topBottleneck      = mem.performance?.top_bottleneck || null;
  const bottleneckEmphasis = topBottleneck ? (BOTTLENECK_EMPHASIS[topBottleneck] || null) : null;
  const boostedSections    = new Set(bottleneckEmphasis?.boost || []);

  // ── Audience signals ──────────────────────────────────────────────────────
  const hasObjections   = !!(mem.audience?.objections);
  const hasPainPoints   = !!(mem.audience?.pain_points);
  const hasProofSignals = !!(
    mem.learnings?.winning_hooks ||
    mem.positioning?.winning_angles ||
    mem.performance?.roas
  );

  // ── Layout preferences (from memory, with safe defaults) ─────────────────
  // form_above_fold: true if memory says so, or if goal is lead_generation
  const formAboveFold = mem.layout_preferences?.form_above_fold ??
    (resolvedGoal === 'lead_generation');

  // Page length: memory → temperature default (cold = long, warm/hot = short)
  const pageLength = mem.layout_preferences?.preferred_page_length ||
    (temperature === 'cold' ? 'long' : 'short');
  const isLong = pageLength === 'long';

  // Template id from memory, or derived from page length
  const templateId = mem.layout_preferences?.preferred_template ||
    (isLong ? 'lp-conversion-rtl' : 'lp-short-offer-rtl');

  // Conversion component: what closes the deal
  const conversionComponent =
    GOAL_CONVERSION_COMPONENT[resolvedGoal] || 'lead_form';

  // CTA urgency: from memory → temperature heuristic
  const urgency =
    mem.cta_preferences?.urgency_level ||
    (temperature === 'hot' ? 'high' : 'moderate');

  // ── Delegate to asset-type builders ──────────────────────────────────────

  if (assetType === 'landing_page_html') {
    return _buildFullPage({
      resolvedGoal, temperature, isLong, templateId,
      conversionComponent, formAboveFold, urgency,
      hasObjections, hasPainPoints, hasProofSignals,
      boostedSections, bottleneckEmphasis, topBottleneck,
      mem,
    });
  }

  if (assetType === 'landing_hero') {
    return _buildHeroOnly({
      resolvedGoal, temperature, formAboveFold, urgency,
      boostedSections, mem,
    });
  }

  // assetType === 'section_block'
  return _buildSectionBlock({
    resolvedGoal, temperature, urgency, mem,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// _buildFullPage — full landing_page_html
// ─────────────────────────────────────────────────────────────────────────────
function _buildFullPage({
  resolvedGoal, temperature, isLong, templateId,
  conversionComponent, formAboveFold, urgency,
  hasObjections, hasPainPoints, hasProofSignals,
  boostedSections, bottleneckEmphasis, topBottleneck,
  mem,
}) {
  const sections = [];
  let order = 1;

  // ── 1. Banner strip ───────────────────────────────────────────────────────
  // Only on warm/hot traffic or high urgency — cold traffic starts with the hero.
  const includeBanner = urgency === 'high' || temperature !== 'cold';
  if (includeBanner) {
    sections.push(makeSection('banner_strip', order++, 'urgency_announcement', {
      required:      false,
      background:    'primary',
      cta_here:      false,
      mobile_visible: true,
      boosted:       boostedSections.has('banner_strip'),
      content_hints: ['cta_preferences.urgency_level', 'business.offer'],
      component_hint: {
        max_chars:      120,
        include_timer:  urgency === 'high',
      },
    }));
  }

  // ── 2. Hero — always required ─────────────────────────────────────────────
  // If form_above_fold + lead_generation: hero contains the lead form inline.
  // Otherwise: hero has a CTA button.
  const heroIncludesForm = formAboveFold && conversionComponent === 'lead_form';

  sections.push(makeSection('hero', order++, 'above_fold_value_proposition', {
    required:      true,
    background:    'default',
    cta_here:      !heroIncludesForm,
    mobile_visible: true,
    boosted:       boostedSections.has('hero'),
    content_hints: [
      'business.promise',
      'business.offer',
      'business.audience',
      'positioning.differentiators',
      'learnings.winning_hooks',         // proven hook → use in headline
      'cta_preferences.proven_cta_text',
    ],
    component_hint: {
      variant:             heroIncludesForm ? 'split-form' : 'split-image',
      form_above_fold:     heroIncludesForm,
      headline_max_words:  12,
      include_subheadline: true,
      image_slot:          !heroIncludesForm,
      cta_variant:         urgency === 'high' ? 'danger' : 'primary',
      cta_size:            'xl',
      min_height:          '70vh',
    },
  }));

  // Inline lead form (placed immediately after hero as a sub-section when above-fold)
  if (heroIncludesForm) {
    sections.push(makeSection('lead_form', order++, 'primary_conversion_above_fold', {
      required:      true,
      background:    'default',
      cta_here:      true,
      mobile_visible: true,
      boosted:       boostedSections.has('lead_form'),
      content_hints: ['business.offer', 'cta_preferences'],
      component_hint: {
        max_fields:  3,          // minimal friction above fold
        cta_variant: 'primary',
        position:    'inline-hero',
      },
    }));
  }

  // ── 3. Stats row — authority signal ──────────────────────────────────────
  // Include when: awareness bottleneck, or explicitly have performance data.
  const includeStats = boostedSections.has('stats_row') || topBottleneck === 'awareness';
  if (includeStats) {
    sections.push(makeSection('stats_row', order++, 'quick_authority_signal', {
      required:      false,
      background:    'muted',
      cta_here:      false,
      mobile_visible: true,
      boosted:       boostedSections.has('stats_row'),
      content_hints: ['performance.ctr', 'performance.roas', 'business.mechanism'],
      component_hint: { max_stats: 4, layout: 'inline' },
    }));
  }

  // ── 4. Pain section — only cold traffic on long pages ────────────────────
  // Warm/hot traffic already knows the problem. Skip to reduce friction.
  if (isLong && hasPainPoints && temperature === 'cold') {
    sections.push(makeSection('pain_section', order++, 'problem_agitation', {
      required:      false,
      background:    'alt',
      cta_here:      false,
      mobile_visible: true,
      boosted:       false,
      content_hints: ['audience.pain_points', 'audience.desires', 'current.main_issue'],
      component_hint: { variant: 'bullets-with-intro', max_bullets: 5 },
    }));
  }

  // ── 5. Mechanism — how it works ───────────────────────────────────────────
  // Always on long pages. ROAS bottleneck boosts this (value clarity matters).
  if (isLong) {
    sections.push(makeSection('mechanism_section', order++, 'how_it_works_trust_builder', {
      required:      true,
      background:    'default',
      cta_here:      false,
      mobile_visible: true,
      boosted:       boostedSections.has('mechanism_section'),
      content_hints: [
        'business.mechanism',
        'positioning.differentiators',
        'business.promise',
      ],
      component_hint: { variant: 'steps', max_steps: 4 },
    }));
  }

  // ── 6. Proof section ──────────────────────────────────────────────────────
  // Always on long. On short, include only if there are proof signals.
  if (isLong || hasProofSignals) {
    sections.push(makeSection('proof_section', order++, 'evidence_removes_skepticism', {
      required:      isLong,
      background:    'dark',
      cta_here:      false,
      mobile_visible: true,
      boosted:       boostedSections.has('proof_section'),
      content_hints: [
        'positioning.winning_angles',
        'learnings.winning_hooks',
        'performance.roas',
        'performance.ctr',
      ],
      component_hint: { variant: 'cards', max_items: isLong ? 3 : 2 },
    }));
  }

  // ── 7. Testimonials — social proof ────────────────────────────────────────
  // After proof section. Long page: always. Short page: only with proof signals.
  if (isLong || hasProofSignals) {
    sections.push(makeSection('testimonials', order++, 'social_proof_risk_reduction', {
      required:      false,
      background:    'alt',
      cta_here:      false,
      mobile_visible: true,
      boosted:       boostedSections.has('testimonials'),
      content_hints: ['learnings.winning_hooks', 'audience.desires'],
      component_hint: {
        variant:       'cards',
        max_items:     isLong ? 3 : 2,
        require_names: true,
      },
    }));
  }

  // ── 8. Mid-page CTA — long pages only, not when form is above fold ────────
  // Placed after testimonials. Reminds reader to act before they hit conversion.
  if (isLong && !heroIncludesForm) {
    sections.push(makeSection('cta_block', order++, 'mid_page_conversion_reminder', {
      required:      false,
      background:    'primary',
      cta_here:      true,
      mobile_visible: true,
      boosted:       false,
      content_hints: ['business.promise', 'cta_preferences'],
      component_hint: {
        variant:     'inline-band',
        position:    'mid',
        cta_variant: urgency === 'high' ? 'danger' : 'primary',
        cta_size:    'lg',
      },
    }));
  }

  // ── 9. Conversion component — lead form or pricing block ──────────────────
  // Skip if form is already above fold (no duplicate form).
  if (!heroIncludesForm) {
    const isPricingBlock = conversionComponent === 'pricing_block';
    sections.push(makeSection(
      conversionComponent,
      order++,
      isPricingBlock ? 'pricing_and_purchase_decision' : 'primary_conversion_point',
      {
        required:      true,
        background:    'default',
        cta_here:      true,
        mobile_visible: true,
        boosted:       boostedSections.has(conversionComponent),
        content_hints: ['business.price', 'business.offer', 'cta_preferences'],
        component_hint: isPricingBlock
          ? { variant: 'single', highlight_best_value: true }
          : {
              max_fields:  4,
              cta_variant: urgency === 'high' ? 'danger' : 'primary',
            },
      }
    ));
  }

  // ── 10. FAQ — objection handling ──────────────────────────────────────────
  // Include when: objections exist in memory, OR long page with conversion bottleneck.
  const includeFaq = hasObjections || (isLong && topBottleneck === 'conversion');
  if (includeFaq) {
    sections.push(makeSection('faq', order++, 'final_objection_handling', {
      required:      false,
      background:    'alt',
      cta_here:      false,
      mobile_visible: true,
      boosted:       boostedSections.has('faq'),
      content_hints: [
        'audience.objections',
        'current.main_issue',
        'learnings.failed_hooks',
      ],
      component_hint: { max_items: 6, layout: 'accordion' },
    }));
  }

  // ── 11. Final CTA — always required, always last ──────────────────────────
  sections.push(makeSection('cta_block', order++, 'final_conversion_action', {
    required:      true,
    background:    'primary',
    cta_here:      true,
    mobile_visible: true,
    boosted:       false,
    content_hints: [
      'business.promise',
      'business.offer',
      'cta_preferences.proven_cta_text',
    ],
    component_hint: {
      variant:         'full-width-band',
      position:        'final',
      cta_size:        'xl',
      cta_variant:     urgency === 'high' ? 'danger' : 'primary',
      include_subtext: true,   // e.g. "ללא התחייבות" — risk reversal line
    },
  }));

  // ── CTA strategy ──────────────────────────────────────────────────────────
  const ctaPositions = sections
    .filter((s) => s.cta_here)
    .map((s) => ({ section: s.id, purpose: s.purpose }));

  const cta_strategy = {
    primary_intent:       mem.cta_preferences?.intent       || 'capture-contact',
    urgency,
    style:                mem.cta_preferences?.style         || 'benefit-led',
    placement:            ctaPositions,
    cta_count:            isLong ? 'multiple' : 'double',
    form_above_fold:      formAboveFold,
    sticky_mobile:        urgency !== 'low',
    conversion_component: conversionComponent,
    proven_cta_text:      mem.cta_preferences?.proven_cta_text || null,
  };

  // ── Hierarchy ─────────────────────────────────────────────────────────────
  const hierarchy = {
    template_id:           templateId,
    page_length:           pageLength,
    traffic_temperature:   temperature,
    primary_goal:          resolvedGoal,
    conversion_component:  conversionComponent,
    proof_position:        isLong ? 'mid' : 'early',
    objection_handling:    hasObjections ? 'faq' : (isLong ? 'testimonials' : 'inline'),
    pain_before_mechanism: isLong && temperature === 'cold' && hasPainPoints,
    critical_path_section: bottleneckEmphasis?.boost?.[0] || 'hero',
    bottleneck_note:       bottleneckEmphasis?.note || null,
    section_count:         sections.length,
    mobile_first:          true,
    rtl:                   true,
  };

  return { sections, cta_strategy, hierarchy };
}

// ─────────────────────────────────────────────────────────────────────────────
// _buildHeroOnly — landing_hero (above-fold block only)
// ─────────────────────────────────────────────────────────────────────────────
function _buildHeroOnly({
  resolvedGoal, temperature, formAboveFold, urgency,
  boostedSections, mem,
}) {
  const sections = [];
  const heroIncludesForm = formAboveFold && resolvedGoal === 'lead_generation';

  sections.push(makeSection('hero', 1, 'above_fold_value_proposition', {
    required:      true,
    background:    'default',
    cta_here:      !heroIncludesForm,
    mobile_visible: true,
    boosted:       boostedSections.has('hero'),
    content_hints: [
      'business.promise',
      'business.offer',
      'business.audience',
      'positioning.differentiators',
      'learnings.winning_hooks',
      'cta_preferences.proven_cta_text',
    ],
    component_hint: {
      variant:             heroIncludesForm ? 'split-form' : 'split-image',
      form_above_fold:     heroIncludesForm,
      headline_max_words:  12,
      include_subheadline: true,
      image_slot:          !heroIncludesForm,
      cta_variant:         urgency === 'high' ? 'danger' : 'primary',
      cta_size:            'xl',
      full_viewport:       true,
    },
  }));

  if (heroIncludesForm) {
    sections.push(makeSection('lead_form', 2, 'inline_conversion_form', {
      required:      true,
      background:    'default',
      cta_here:      true,
      mobile_visible: true,
      boosted:       false,
      content_hints: ['business.offer', 'cta_preferences'],
      component_hint: {
        max_fields:  3,
        cta_variant: 'primary',
        position:    'inline-hero',
      },
    }));
  }

  const cta_strategy = {
    primary_intent:       mem.cta_preferences?.intent       || 'capture-contact',
    urgency,
    style:                mem.cta_preferences?.style         || 'benefit-led',
    placement:            [{ section: 'hero', purpose: 'above_fold_value_proposition' }],
    cta_count:            'single',
    form_above_fold:      formAboveFold,
    sticky_mobile:        false,
    conversion_component: heroIncludesForm ? 'lead_form' : 'cta_block',
    proven_cta_text:      mem.cta_preferences?.proven_cta_text || null,
  };

  const hierarchy = {
    template_id:           'hero-only',
    page_length:           'above-fold',
    traffic_temperature:   temperature,
    primary_goal:          resolvedGoal,
    conversion_component:  heroIncludesForm ? 'lead_form' : 'cta_block',
    proof_position:        null,
    objection_handling:    null,
    pain_before_mechanism: false,
    critical_path_section: 'hero',
    bottleneck_note:       null,
    section_count:         sections.length,
    mobile_first:          true,
    rtl:                   true,
  };

  return { sections, cta_strategy, hierarchy };
}

// ─────────────────────────────────────────────────────────────────────────────
// _buildSectionBlock — single standalone section
// Goal drives which section type is selected as the single output.
// ─────────────────────────────────────────────────────────────────────────────
function _buildSectionBlock({
  resolvedGoal, temperature, urgency, mem,
}) {
  const sectionType = GOAL_TO_SECTION_BLOCK[resolvedGoal] || 'cta_block';

  const sections = [
    makeSection(sectionType, 1, `standalone_${sectionType}`, {
      required:      true,
      background:    'default',
      cta_here:      true,
      mobile_visible: true,
      boosted:       false,
      content_hints: ['business.offer', 'business.promise', 'cta_preferences'],
      component_hint: {
        standalone:  true,
        cta_variant: urgency === 'high' ? 'danger' : 'primary',
        cta_size:    'lg',
      },
    }),
  ];

  const cta_strategy = {
    primary_intent:       mem.cta_preferences?.intent       || 'capture-contact',
    urgency,
    style:                mem.cta_preferences?.style         || 'benefit-led',
    placement:            [{ section: sectionType, purpose: `standalone_${sectionType}` }],
    cta_count:            'single',
    form_above_fold:      false,
    sticky_mobile:        false,
    conversion_component: sectionType,
    proven_cta_text:      mem.cta_preferences?.proven_cta_text || null,
  };

  const hierarchy = {
    template_id:           'section-block',
    page_length:           'single-section',
    traffic_temperature:   temperature,
    primary_goal:          resolvedGoal,
    conversion_component:  sectionType,
    proof_position:        null,
    objection_handling:    null,
    pain_before_mechanism: false,
    critical_path_section: sectionType,
    bottleneck_note:       null,
    section_count:         1,
    mobile_first:          true,
    rtl:                   true,
  };

  return { sections, cta_strategy, hierarchy };
}

module.exports = { buildLandingStructure };
