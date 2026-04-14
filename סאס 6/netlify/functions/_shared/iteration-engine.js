'use strict';

/**
 * iteration-engine.js — Asset Variation Engine
 *
 * Takes a base LandingStructure + MarketingMemory and produces N distinct
 * structural variants, each driven by a different persuasion strategy.
 *
 * VARIATION MODES:
 *   aggressive — high-pressure urgency, short page, danger CTAs, fear-of-missing-out
 *   premium    — calm prestige, long page, trust signals boosted, no rush
 *   minimal    — hero + form only, one message, zero distraction
 *   bold       — dark sections, large stats, high contrast, strong claims
 *   emotional  — empathy arc: pain → understanding → proof → solution
 *
 * WHAT EACH MODE ACTUALLY CHANGES (not cosmetic):
 *   - Section set: which sections are included / excluded
 *   - Section order: pain before mechanism vs. mechanism first, etc.
 *   - Section backgrounds: dark/primary/muted overrides per section
 *   - CTA strategy: variant (danger/primary), size (xl/lg), urgency text
 *   - Memory overlays: urgency_level, style, page_length, funnel_stage
 *   These together produce meaningfully different HTML, not just color swaps.
 *
 * Usage:
 *   const { applyVariationMode, selectVariationModes } = require('./iteration-engine');
 *   const { structure, memory, label, description } =
 *     applyVariationMode('aggressive', baseStructure, baseMemory);
 *
 * Rules:
 *   - Never mutates inputs. Always deep-clones before modifying.
 *   - Required sections (required:true) are never removed.
 *   - Renumbers section.order 1..N after every structural change.
 */

// ── Public mode list ──────────────────────────────────────────────────────────

const VARIATION_MODES = ['aggressive', 'premium', 'minimal', 'bold', 'emotional'];

// Maximally-distinct triplet — covers urgency, minimalism, and emotion simultaneously
const CONTRAST_TRIO   = ['aggressive', 'minimal', 'emotional'];
// Extended sets
const CONTRAST_FOUR   = ['aggressive', 'minimal', 'emotional', 'premium'];
const CONTRAST_FIVE   = ['aggressive', 'minimal', 'emotional', 'premium', 'bold'];

// ── Mode specifications ───────────────────────────────────────────────────────

const VARIATION_SPECS = Object.freeze({

  // ── Aggressive ──────────────────────────────────────────────────────────────
  // Strategy: short page, high urgency, FOMO, danger CTAs, fast conversion path
  aggressive: {
    label:       'אגרסיבי — לחץ ודחיפות',
    description: 'דף קצר, CTA אדום, באנר דחיפות בראש הדף, מיקוד בפחד מהחמצה',
    memory_overlay: {
      cta_preferences:    { urgency_level: 'high', style: 'urgency-led' },
      layout_preferences: { preferred_page_length: 'short', form_above_fold: true },
      current:            { funnel_stage: 'hot' },
    },
    structure_fn: _applyAggressive,
  },

  // ── Premium ─────────────────────────────────────────────────────────────────
  // Strategy: long page, prestige positioning, slow trust build, no rush
  premium: {
    label:       'פרמיום — יוקרה ואמון',
    description: 'דף ארוך, עיצוב נקי, המלצות לקוחות, מיקוד בערך ואמינות',
    memory_overlay: {
      cta_preferences:    { urgency_level: 'low', style: 'prestige-led' },
      layout_preferences: { preferred_page_length: 'long', form_above_fold: false },
      current:            { funnel_stage: 'warm' },
    },
    structure_fn: _applyPremium,
  },

  // ── Minimal ─────────────────────────────────────────────────────────────────
  // Strategy: ruthless reduction — one message, one action, zero friction
  minimal: {
    label:       'מינימלי — פשוט וממוקד',
    description: 'Hero + טופס בלבד, ללא הסחות דעת, מסר אחד ברור',
    memory_overlay: {
      cta_preferences:    { urgency_level: 'moderate', style: 'benefit-led' },
      layout_preferences: {
        preferred_page_length: 'short',
        form_above_fold:       true,
        preferred_template:    'lp-short-offer-rtl',
      },
    },
    structure_fn: _applyMinimal,
  },

  // ── Bold ────────────────────────────────────────────────────────────────────
  // Strategy: strong claims, high contrast, numbers front-and-center
  bold: {
    label:       'בולד — הצהרות חזקות',
    description: 'רקעים כהים, מספרים גדולים, ניגודיות גבוהה, נוכחות חזקה',
    memory_overlay: {
      cta_preferences:    { urgency_level: 'high', style: 'bold-statement' },
      layout_preferences: { preferred_page_length: 'long' },
      performance:        { top_bottleneck: 'awareness' },
    },
    structure_fn: _applyBold,
  },

  // ── Emotional ───────────────────────────────────────────────────────────────
  // Strategy: empathy arc — start with pain, build understanding, earn the sale
  emotional: {
    label:       'אמוציונלי — חיבור רגשי',
    description: 'מתחיל בכאב של הלקוח, בונה אמפתיה, המלצות לקוחות, מוביל לפתרון',
    memory_overlay: {
      cta_preferences:    { urgency_level: 'moderate', style: 'emotion-led' },
      layout_preferences: { preferred_page_length: 'long' },
      current:            { funnel_stage: 'cold' },
    },
    structure_fn: _applyEmotional,
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// applyVariationMode — main export
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {string}          mode      — one of VARIATION_MODES
 * @param {LandingStructure} structure — from buildLandingStructure()
 * @param {MarketingMemory}  memory   — from buildMarketingMemory()
 * @returns {{ structure, memory, label, description }}
 */
function applyVariationMode(mode, structure, memory) {
  const spec = VARIATION_SPECS[mode];
  if (!spec) throw new Error(`[iteration-engine] Unknown mode: "${mode}". Valid: ${VARIATION_MODES.join(', ')}`);

  const patchedMemory    = _patchMemory(memory, spec.memory_overlay);
  const patchedStructure = _patchStructure(structure, spec.structure_fn);

  return {
    structure:   patchedStructure,
    memory:      patchedMemory,
    label:       spec.label,
    description: spec.description,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// selectVariationModes — choose N maximally-distinct modes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {number} count — how many modes to return (1–5)
 * @returns {string[]}
 */
function selectVariationModes(count = 3) {
  const pool = [CONTRAST_TRIO, CONTRAST_FOUR, CONTRAST_FIVE];
  const n    = Math.max(1, Math.min(count, VARIATION_MODES.length));
  if (n <= 3) return CONTRAST_TRIO.slice(0, n);
  return (pool[n - 3] || CONTRAST_FIVE).slice(0, n);
}

// ─────────────────────────────────────────────────────────────────────────────
// Structure patch functions — one per mode
// Each receives a mutable sections array (already deep-cloned) and returns
// a new sections array. Required sections are never removed.
// ─────────────────────────────────────────────────────────────────────────────

function _applyAggressive(sections) {
  // 1. Strip non-essential sections — keep only the fast conversion path
  const KEEP = new Set(['banner_strip', 'hero', 'pain_section', 'lead_form', 'pricing_block', 'cta_block']);
  let result = sections.filter(s => s.required || KEEP.has(s.id));

  // 2. Ensure banner_strip is present (urgency anchor)
  if (!_has(result, 'banner_strip')) {
    result.unshift(_makeSection('banner_strip', 'urgency_announcement', 'primary', {
      max_chars:     100,
      include_timer: true,
    }));
  }

  // 3. Override all CTA-bearing sections → danger variant, xl size
  result = result.map(s => {
    if (!s.cta_here && s.id !== 'hero' && s.id !== 'cta_block') return s;
    return _hint(s, { cta_variant: 'danger', cta_size: 'xl' });
  });

  // 4. Hero: full viewport, no subheadline (direct hit)
  result = result.map(s => s.id === 'hero'
    ? _hint(s, { cta_variant: 'danger', cta_size: 'xl', min_height: '80vh', include_subheadline: false })
    : s
  );

  // 5. Banner: make sure timer is on
  result = result.map(s => s.id === 'banner_strip'
    ? _hint(s, { include_timer: true })
    : s
  );

  return result;
}

function _applyPremium(sections) {
  // 1. Remove urgency banner — premium doesn't rush
  let result = sections.filter(s => s.id !== 'banner_strip');

  // 2. Ensure testimonials are present (trust anchor)
  if (!_has(result, 'testimonials')) {
    const proofIdx = result.findIndex(s => s.id === 'proof_section');
    const insertAt = proofIdx >= 0 ? proofIdx + 1 : result.length - 1;
    result.splice(insertAt, 0, _makeSection('testimonials', 'social_proof_risk_reduction', 'alt', {
      variant:       'cards',
      max_items:     3,
      require_names: true,
    }));
  }

  // 3. Ensure mechanism_section is present (explain the value)
  if (!_has(result, 'mechanism_section')) {
    const heroIdx  = result.findIndex(s => s.id === 'hero');
    const insertAt = heroIdx >= 0 ? heroIdx + 1 : 1;
    result.splice(insertAt, 0, _makeSection('mechanism_section', 'how_it_works_trust_builder', 'default', {
      variant:   'steps',
      max_steps: 4,
    }));
  }

  // 4. All CTAs → calm primary variant, lg size (premium doesn't shout)
  result = result.map(s => {
    if (!s.cta_here && s.id !== 'hero' && s.id !== 'cta_block') return s;
    return _hint(s, { cta_variant: 'primary', cta_size: 'lg' });
  });

  // 5. Hero: include subheadline for nuance, split-image layout
  result = result.map(s => s.id === 'hero'
    ? _hint(s, { cta_variant: 'primary', cta_size: 'lg', include_subheadline: true, variant: 'split-image', min_height: '65vh' })
    : s
  );

  // 6. Testimonials: boost and maximise
  result = result.map(s => s.id === 'testimonials'
    ? { ..._hint(s, { max_items: 3, require_names: true }), boosted: true }
    : s
  );

  // 7. Final CTA: include reassurance subtext (e.g. "ללא התחייבות")
  result = result.map(s =>
    s.id === 'cta_block' && s.purpose?.includes('final')
      ? _hint(s, { include_subtext: true })
      : s
  );

  return result;
}

function _applyMinimal(sections) {
  // 1. Keep ONLY the bare conversion path — hero + conversion component + final CTA
  const KEEP = new Set(['hero', 'lead_form', 'pricing_block', 'cta_block']);
  let result = sections.filter(s => s.required || KEEP.has(s.id));

  // 2. If two cta_blocks survived (mid + final), keep only the final one
  const ctaBlocks = result.filter(s => s.id === 'cta_block');
  if (ctaBlocks.length > 1) {
    const finalCta = ctaBlocks.find(s => s.purpose?.includes('final')) || ctaBlocks[ctaBlocks.length - 1];
    result = result.filter(s => s.id !== 'cta_block' || s === finalCta);
  }

  // 3. Hero: focused single message, form-facing
  result = result.map(s => s.id === 'hero'
    ? _hint(s, { cta_variant: 'primary', cta_size: 'xl', min_height: '60vh', include_subheadline: true, variant: 'split-image' })
    : s
  );

  // 4. Lead form: minimal fields, no friction
  result = result.map(s => s.id === 'lead_form'
    ? _hint(s, { max_fields: 3, cta_variant: 'primary' })
    : s
  );

  return result;
}

function _applyBold(sections) {
  // 1. Ensure banner_strip at top
  let result = [...sections];
  if (!_has(result, 'banner_strip')) {
    result.unshift(_makeSection('banner_strip', 'urgency_announcement', 'primary', {
      max_chars:     120,
      include_timer: false,
    }));
  }

  // 2. Ensure stats_row (numbers make bold claims concrete)
  if (!_has(result, 'stats_row')) {
    const heroIdx  = result.findIndex(s => s.id === 'hero');
    const insertAt = heroIdx >= 0 ? heroIdx + 1 : 1;
    result.splice(insertAt, 0, _makeSection('stats_row', 'quick_authority_signal', 'muted', {
      max_stats: 4,
      layout:    'inline',
    }));
  }

  // 3. Ensure proof_section
  if (!_has(result, 'proof_section')) {
    const statsIdx = result.findIndex(s => s.id === 'stats_row');
    const insertAt = statsIdx >= 0 ? statsIdx + 1 : result.length - 1;
    result.splice(insertAt, 0, _makeSection('proof_section', 'evidence_removes_skepticism', 'dark', {
      variant:   'cards',
      max_items: 3,
    }));
  }

  // 4. Override section backgrounds for maximum contrast
  result = result.map(s => {
    if (s.id === 'hero')         return { ..._hint(s, { cta_variant: 'primary', cta_size: 'xl', min_height: '75vh' }), background: 'dark' };
    if (s.id === 'proof_section') return { ...s, background: 'dark', boosted: true };
    if (s.id === 'stats_row')    return { ..._hint(s, { max_stats: 4, layout: 'inline' }), boosted: true };
    if (s.id === 'cta_block' && s.purpose?.includes('final')) return { ..._hint(s, { cta_variant: 'primary', cta_size: 'xl' }), background: 'primary' };
    return s;
  });

  return result;
}

function _applyEmotional(sections) {
  // 1. Remove urgency banner — emotional starts gently
  let result = sections.filter(s => s.id !== 'banner_strip');

  // 2. Ensure pain_section immediately after hero (empathy comes first)
  if (!_has(result, 'pain_section')) {
    const heroIdx  = result.findIndex(s => s.id === 'hero');
    const insertAt = heroIdx >= 0 ? heroIdx + 1 : 0;
    result.splice(insertAt, 0, _makeSection('pain_section', 'problem_agitation', 'alt', {
      variant:     'bullets-with-intro',
      max_bullets: 5,
    }));
  } else {
    // Move pain_section to right after hero if it isn't there already
    const heroIdx = result.findIndex(s => s.id === 'hero');
    const painIdx = result.findIndex(s => s.id === 'pain_section');
    if (heroIdx >= 0 && painIdx >= 0 && painIdx !== heroIdx + 1) {
      const [painSection] = result.splice(painIdx, 1);
      result.splice(heroIdx + 1, 0, painSection);
    }
  }

  // 3. Ensure mechanism_section (after pain — explain the solution)
  if (!_has(result, 'mechanism_section')) {
    const painIdx  = result.findIndex(s => s.id === 'pain_section');
    const insertAt = painIdx >= 0 ? painIdx + 1 : result.length - 1;
    result.splice(insertAt, 0, _makeSection('mechanism_section', 'how_it_works_trust_builder', 'default', {
      variant:   'steps',
      max_steps: 4,
    }));
  }

  // 4. Ensure testimonials (real people, real outcomes — emotional payoff)
  if (!_has(result, 'testimonials')) {
    const mechIdx  = result.findIndex(s => s.id === 'mechanism_section');
    const insertAt = mechIdx >= 0 ? mechIdx + 1 : result.length - 1;
    result.splice(insertAt, 0, _makeSection('testimonials', 'social_proof_risk_reduction', 'alt', {
      variant:       'cards',
      max_items:     3,
      require_names: true,
    }));
  }

  // 5. Boost pain and testimonials — these carry the emotional weight
  result = result.map(s => {
    if (s.id === 'pain_section')  return { ..._hint(s, { variant: 'bullets-with-intro', max_bullets: 5 }), boosted: true, background: 'alt' };
    if (s.id === 'testimonials')  return { ..._hint(s, { max_items: 3, require_names: true }), boosted: true };
    return s;
  });

  // 6. Hero: gentle CTA, include empathetic subheadline
  result = result.map(s => s.id === 'hero'
    ? _hint(s, { cta_variant: 'primary', cta_size: 'xl', include_subheadline: true, min_height: '70vh' })
    : s
  );

  // 7. Final CTA: reassurance subtext
  result = result.map(s =>
    s.id === 'cta_block' && s.purpose?.includes('final')
      ? _hint(s, { include_subtext: true, cta_variant: 'primary' })
      : s
  );

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

// Deep-clone memory (plain object, no functions) and merge overlay
function _patchMemory(memory, overlay) {
  if (!overlay) return memory;
  const cloned = JSON.parse(JSON.stringify(memory));
  for (const [key, patch] of Object.entries(overlay)) {
    if (cloned[key] && typeof cloned[key] === 'object' && !Array.isArray(cloned[key])) {
      Object.assign(cloned[key], patch);
    } else {
      cloned[key] = { ...patch };
    }
  }
  return cloned;
}

// Clone structure and apply the mode's structure function to sections
function _patchStructure(structure, structureFn) {
  // Sections may be frozen — spread-clone each one before passing to structureFn
  const clonedSections = structure.sections.map(s => ({ ...s, component_hint: { ...s.component_hint } }));
  const modified       = structureFn ? structureFn(clonedSections) : clonedSections;
  return {
    ...structure,
    sections:     _renumber(modified),
    cta_strategy: { ...structure.cta_strategy },
    hierarchy:    { ...structure.hierarchy },
  };
}

// Spread-clone a section and merge component_hint patch
function _hint(section, hintPatch) {
  return {
    ...section,
    component_hint: { ...section.component_hint, ...hintPatch },
  };
}

// True if sections array contains at least one section of the given type
function _has(sections, id) {
  return sections.some(s => s.id === id);
}

// Create a minimal section object (plain, not frozen)
function _makeSection(id, purpose, background = 'default', hints = {}) {
  return {
    id,
    order:          99,   // renumbered after all modifications
    purpose,
    required:       false,
    background,
    cta_here:       false,
    mobile_visible: true,
    boosted:        false,
    content_hints:  [],
    component_hint: hints,
  };
}

// Reassign section.order 1..N based on current array position
function _renumber(sections) {
  return sections.map((s, i) => ({ ...s, order: i + 1 }));
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = { applyVariationMode, selectVariationModes, VARIATION_MODES };
