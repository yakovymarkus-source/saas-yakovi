'use strict';

/**
 * prompt-builders/ad-creative.js — Ad Creative Brief Prompt Builder (v2)
 *
 * Builds prompts for the ad_creative capability → routed to Claude.
 *
 * v2 CHANGES FROM v1:
 *   - Input changed: now accepts { memory, contextPack, adCopyVariants, platform }
 *     instead of { businessProfile, adCopyVariants, platform }
 *   - Two-stage prompt: DECIDE first, then GENERATE
 *   - Uses contextPack priorities instead of raw businessProfile fields
 *   - Richer output shape with scene logic, composition, and image generation fields
 *   - Enforcement rules prevent generic output
 *
 * Input: { memory, contextPack, adCopyVariants, platform }
 *   memory      — full MarketingMemory from buildMarketingMemory()
 *   contextPack — focused context from buildCreativeContext(memory, assetType)
 *   adCopyVariants — array of ad copy variant objects (optional)
 *   platform    — 'meta' | 'google_ads' | 'story'
 *
 * Expected output from Claude:
 * {
 *   "decision": {
 *     "primary_emotional_trigger": string,
 *     "chosen_visual_mechanism": string,
 *     "non_generic_angle": string,
 *     "two_second_clarity_test": string
 *   },
 *   "creatives": [
 *     {
 *       "variant_name": string,
 *       "emotional_angle": string,
 *       "visual_strategy": string,
 *       "why_it_works": string,
 *       "core_scene": string,
 *       "composition_notes": string,
 *       "subject_details": string,
 *       "environment_details": string,
 *       "symbolic_elements": string[],
 *       "tension_or_contrast": string,
 *       "text_overlay": string,
 *       "style_direction": string,
 *       "color_palette": string[],
 *       "platform_fit": string,
 *       "designer_notes": string,
 *       "external_image_prompt": string
 *     }
 *   ]
 * }
 */

// ── Helpers ───────────────────────────────────────────────────────────────────

// Safe string — returns the value or a fallback marker
const s = (v, fallback = null) =>
  (typeof v === 'string' && v.trim().length > 0) ? v.trim() : fallback;

// Format visual_constraints object into readable lines
function formatConstraints(vc) {
  if (!vc || typeof vc !== 'object') return 'Use platform defaults.';
  return Object.entries(vc)
    .map(([k, v]) => `  • ${k}: ${v}`)
    .join('\n');
}

// Format ad copy variants into a readable block
function formatVariants(adCopyVariants) {
  if (!Array.isArray(adCopyVariants) || adCopyVariants.length === 0) {
    return 'No ad copy provided — generate creatives based on the strategic brief only.';
  }
  return adCopyVariants.map((v, i) => {
    const label = v.variant || String.fromCharCode(65 + i);
    const lines = [
      `Variant ${label}:`,
      v.framework    ? `  Framework:  ${v.framework}` : null,
      v.headline     ? `  Headline:   ${v.headline}` : null,
      v.body         ? `  Body (first line): ${v.body.split('\n')[0]}` : null,
      v.cta          ? `  CTA:        ${v.cta}` : null,
      v.platform_note ? `  Note:       ${v.platform_note}` : null,
    ].filter(Boolean);
    return lines.join('\n');
  }).join('\n\n');
}

// Build supporting signals block — only include fields that are non-null
function formatSupportingSignals(supporting) {
  if (!supporting || typeof supporting !== 'object') return null;

  const lines = [];

  if (supporting.performance_note) {
    lines.push(`⚠ Performance signal: ${supporting.performance_note}`);
  }
  if (Array.isArray(supporting.winning_angles) && supporting.winning_angles.length > 0) {
    lines.push(`✓ Proven winning angles: ${supporting.winning_angles.join(' | ')}`);
  }
  if (Array.isArray(supporting.proven_hooks) && supporting.proven_hooks.length > 0) {
    lines.push(`✓ Proven hooks from A/B tests: ${supporting.proven_hooks.join(' | ')}`);
  }
  if (Array.isArray(supporting.avoid_angles) && supporting.avoid_angles.length > 0) {
    lines.push(`✗ Do NOT use — tested and failed: ${supporting.avoid_angles.join(' | ')}`);
  }
  if (supporting.active_issue) {
    lines.push(`Current bottleneck: ${supporting.active_issue}`);
  }
  if (supporting.price_anchor) {
    lines.push(`Price anchor for context: ${supporting.price_anchor}`);
  }

  return lines.length > 0 ? lines.join('\n') : null;
}

// ── Platform rules ────────────────────────────────────────────────────────────

function getPlatformRules(platform, visualConstraints) {
  // Use visual_constraints from contextPack if available — they are asset-type-aware
  // Fall back to hard-coded platform defaults
  const fromPack = visualConstraints ? formatConstraints(visualConstraints) : null;

  if (fromPack) return `Platform constraints (from creative brief):\n${fromPack}`;

  if (platform === 'google_ads') {
    return 'Platform: Google Display.\n  • Formats: 1:1 and 1.91:1\n  • Minimal text\n  • Logo must be prominent';
  }
  if (platform === 'story') {
    return 'Platform: Instagram/Facebook Stories.\n  • Format: 9:16 vertical\n  • Bold text\n  • First frame must hook in under 1 second';
  }
  return 'Platform: Meta (Facebook/Instagram).\n  • Primary format: 1:1 or 4:5 feed post\n  • Text overlay: max 20% of image area';
}

// ── Stage-specific instruction blocks ────────────────────────────────────────

function getStageOneInstructions(assetType) {
  // The DECIDE stage adapts based on asset type — cold traffic vs warm traffic
  // have fundamentally different creative priorities
  const isLandingHero = assetType === 'landing_hero';
  const isBanner      = assetType === 'banner';
  const isRetargeting = assetType === 'retargeting';

  const priorityNote = isLandingHero
    ? 'This is a LANDING HERO asset. Trust and promise clarity matter more than interruption. The viewer already clicked — do not re-sell, validate.'
    : isRetargeting
      ? 'This is a RETARGETING asset. The viewer has seen this brand before. Interruption is less important than objection removal and friction reduction.'
      : isBanner
        ? 'This is a BANNER asset. One message only. Clarity beats cleverness at this size.'
        : 'This is a COLD TRAFFIC ad asset. Recognition and interruption matter more than explanation. Stop the scroll first.';

  return `
STAGE 1 — DECIDE (answer all four questions before generating)

${priorityNote}

Answer:
  1. PRIMARY EMOTIONAL TRIGGER
     Which signal from the brief (pain, desire, objection, or promise) is the strongest hook for this audience at this stage?
     Do not invent — choose from what is in the brief.

  2. VISUAL MECHANISM
     Which visual approach best communicates this trigger for this asset type?
     Options: pattern interrupt | before/after contrast | scene of pain | scene of aspiration | product in context | social proof frame | unexpected juxtaposition | text-forward | symbolic metaphor | other (explain).

  3. NON-GENERIC ANGLE
     What specific detail from THIS business makes this concept impossible to copy-paste onto any other brand?
     If you cannot name a specific detail, the concept is too generic — restart.

  4. TWO-SECOND CLARITY TEST
     Describe what a viewer understands ONLY from the visual, before reading any text.
     If the answer is "nothing" or "unclear" — the concept fails; restart.
`;
}

function getStageTwoInstructions() {
  return `
STAGE 2 — GENERATE 3 DISTINCT VISUAL CONCEPTS

Based on your decisions above, generate exactly 3 concepts.

DIFFERENTIATION RULES (strictly enforced):
  • The 3 concepts must differ by: emotional angle, visual mechanism, OR scene logic
  • Changing only colors, fonts, or models is NOT differentiation — reject it
  • Each concept must be meaningfully different in what it COMMUNICATES, not just how it looks

QUALITY RULES (each concept must pass all of these):
  • Contains at least one: visual tension, contrast, unexpected element, or paradox
  • Passes the 2-second test: the viewer gets the core message from the visual alone, without reading text
  • Does NOT use stock-photo aesthetics: no generic smiling people, no handshakes, no motivational sunrises
  • Does NOT invent facts not present in the strategic brief
  • If a concept could fit any business in this category → it is too generic → replace it

SIGNAL PRIORITY:
  • Proven signals (winning hooks, known angles) > inferred signals (performance notes) > generic assumptions
  • Use supporting_context signals only when directly relevant to the concept
  • Weak signals (inferred, low-confidence) must not anchor a concept — use as flavor only
`;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * buildAdCreativePrompt({ memory, contextPack, adCopyVariants, platform })
 */
function buildAdCreativePrompt({
  memory         = {},
  contextPack    = {},
  adCopyVariants = [],
  platform       = 'meta',
}) {
  // Extract what we need from contextPack — this is the pre-filtered creative brief
  const assetType        = s(contextPack.asset_type,               'ad_visual');
  const objective        = s(contextPack.objective,                'Generate effective visual ad creative');
  const targetAudience   = s(contextPack.target_audience,          'לא צוין');
  const emotionalTrigger = s(contextPack.core_emotional_trigger,   'לא צוין');
  const primaryMessage   = s(contextPack.primary_message,          'לא צוין');
  const differentiator   = s(contextPack.differentiator,           'לא צוין');
  const objection        = s(contextPack.objection,                null);
  const desired2Sec      = s(contextPack.desired_2_second_reaction, null);
  const funnelStage      = s(contextPack.funnel_stage,             'unknown');
  const toneGuidance     = s(contextPack.tone_guidance,            'professional, direct');

  // Visual constraints come from contextPack (already asset-type-aware)
  const platformRules = getPlatformRules(platform, contextPack.visual_constraints);

  // Supporting signals — format only non-null entries
  const signalsBlock = formatSupportingSignals(contextPack.supporting_context);

  // Ad copy variants — format if provided
  const variantsBlock = formatVariants(adCopyVariants);

  // Stage-specific decision and generation instructions
  const stageOneBlock = getStageOneInstructions(assetType);
  const stageTwoBlock = getStageTwoInstructions();

  // ── System prompt ──────────────────────────────────────────────────────────
  const system = `You are a senior creative director specializing in Israeli direct-response digital advertising.
You think strategically before you generate. You never produce generic work.
You understand Israeli market psychology, visual culture, and what stops a scroll in Hebrew-speaking feeds.

ABSOLUTE RULES:
  • You ALWAYS return valid JSON only — no markdown, no explanation, no text outside the JSON object
  • All Hebrew-language fields (core_scene, text_overlay, composition_notes, designer_notes) MUST be written in Hebrew
  • external_image_prompt MUST be in English (used with DALL-E / Midjourney / Ideogram)
  • Do not hallucinate. Every creative decision must be grounded in the strategic brief provided
  • Do not produce concepts that could apply to any business — specificity is the only measure of quality
  • If a concept is generic, it is wrong — produce a different one`;

  // ── User prompt ────────────────────────────────────────────────────────────
  const user = `
══════════════════════════════════════════════════════
STRATEGIC BRIEF — ${assetType.toUpperCase()}
══════════════════════════════════════════════════════

OBJECTIVE
${objective}

TARGET AUDIENCE
${targetAudience}

CORE EMOTIONAL TRIGGER  ← anchor your concepts here
${emotionalTrigger}

PRIMARY MESSAGE
${primaryMessage}

DIFFERENTIATOR
${differentiator}
${objection ? `\nMAIN OBJECTION TO PRE-EMPT\n${objection}` : ''}
${desired2Sec ? `\nDESIRED 2-SECOND REACTION\n${desired2Sec}` : ''}

FUNNEL STAGE
${funnelStage}

TONE GUIDANCE
${toneGuidance}

PLATFORM CONSTRAINTS
${platformRules}
${signalsBlock ? `\n══════════════════════════════════════════════════════\nSUPPORTING SIGNALS (use only when directly relevant)\n══════════════════════════════════════════════════════\n${signalsBlock}` : ''}

══════════════════════════════════════════════════════
AD COPY VARIANTS TO MATCH
══════════════════════════════════════════════════════

${variantsBlock}

══════════════════════════════════════════════════════
${stageOneBlock}
══════════════════════════════════════════════════════
${stageTwoBlock}
══════════════════════════════════════════════════════
REQUIRED OUTPUT FORMAT
══════════════════════════════════════════════════════

Return this exact JSON. No other text. No markdown.

{
  "decision": {
    "primary_emotional_trigger": "Which signal you chose and why — one sentence",
    "chosen_visual_mechanism": "Which visual mechanism you chose and why — one sentence",
    "non_generic_angle": "The specific business detail that makes this non-generic — one sentence",
    "two_second_clarity_test": "What the viewer understands from the visual alone in 2 seconds — one sentence"
  },
  "creatives": [
    {
      "variant_name": "Short name capturing the emotional angle — e.g. 'Pain Recognition' or 'Transformation Proof'",
      "emotional_angle": "The specific emotion being activated — e.g. frustration, aspiration, urgency, relief",
      "visual_strategy": "The visual mechanism chosen for this concept — explain in one sentence",
      "why_it_works": "Why this visual approach works for this audience at this funnel stage — one sentence",
      "core_scene": "תיאור מדויק של הסצנה המרכזית בעברית — מה בדיוק רואים",
      "composition_notes": "הנחיות קומפוזיציה: מיקום המוקד, שליש, מרחק צילום — בעברית",
      "subject_details": "תיאור הדמות/אובייקט המרכזי: גיל, מראה, הבעה, בגדים — בעברית",
      "environment_details": "תיאור הסביבה: מיקום, רקע, תאורה, שעה — בעברית",
      "symbolic_elements": ["אלמנט סמלי ראשון בעברית", "אלמנט סמלי שני בעברית"],
      "tension_or_contrast": "What visual tension, contrast, or unexpected element creates interest — in Hebrew",
      "text_overlay": "הטקסט שיופיע על התמונה — מקסימום 5 מילים, בעברית",
      "style_direction": "Photorealistic / Flat illustration / Bold graphic / Documentary / etc.",
      "color_palette": ["#hex1", "#hex2", "#hex3"],
      "platform_fit": "Why this concept works specifically for the stated platform format",
      "designer_notes": "הנחיות נוספות לדיזיינר — דגשים שלא נאמרו בשדות אחרים — בעברית",
      "external_image_prompt": "Detailed English prompt for DALL-E / Midjourney / Ideogram. Include: subject, environment, composition, lighting, color, style, aspect ratio, mood. Do NOT include Hebrew text or brand names."
    }
  ]
}`;

  return { system, user, maxTokens: 3500 };
}

module.exports = { buildAdCreativePrompt };
