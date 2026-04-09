'use strict';

/**
 * prompt-builders/ad-copy.js — Ad Copy Prompt Builder
 *
 * Builds the system + user prompt for the ad_copy capability.
 * Passed to the OpenAI adapter which executes it.
 *
 * Input: { businessProfile, bottleneck, platform }
 * Expected output shape from OpenAI:
 * {
 *   variants: [
 *     {
 *       variant:       'A',
 *       framework:     'problem_agitate',
 *       hook_type:     'פתיחת כאב',
 *       headline:      string,
 *       body:          string,
 *       cta:           string,
 *       platform_note: string,
 *     },
 *     ...  (exactly 3)
 *   ]
 * }
 */

const FRAMEWORK_DESCRIPTIONS = {
  problem_agitate: 'Problem-Agitate: Start with the painful problem the audience faces. Agitate it briefly. Then present the solution.',
  result_first:    'Result-First: Lead with the desired outcome/transformation. Then explain how the product delivers it.',
  mechanism:       'Mechanism: Lead with the unique method or mechanism that makes the product different from alternatives.',
};

// Bottleneck → framework priority order
const BOTTLENECK_ORDER = {
  ctr:          ['problem_agitate', 'result_first', 'mechanism'],
  creative:     ['problem_agitate', 'result_first', 'mechanism'],
  conversion:   ['result_first', 'mechanism', 'problem_agitate'],
  landing_page: ['result_first', 'mechanism', 'problem_agitate'],
  roas:         ['mechanism', 'result_first', 'problem_agitate'],
  budget:       ['mechanism', 'result_first', 'problem_agitate'],
};
const DEFAULT_ORDER = ['problem_agitate', 'result_first', 'mechanism'];

function getFrameworkOrder(bottleneck) {
  return BOTTLENECK_ORDER[bottleneck] || DEFAULT_ORDER;
}

/**
 * buildAdCopyPrompt({ businessProfile, bottleneck, platform })
 * Returns { system, user, maxTokens }
 */
function buildAdCopyPrompt({ businessProfile = {}, bottleneck = null, platform = 'meta' }) {
  const bp = businessProfile;
  const order = getFrameworkOrder(bottleneck);

  const frameworkInstructions = order.map((fw, i) => {
    const label = String.fromCharCode(65 + i); // A, B, C
    return `Variant ${label}: Use the "${fw}" framework.\n  ${FRAMEWORK_DESCRIPTIONS[fw]}`;
  }).join('\n\n');

  const bottleneckContext = bottleneck
    ? `CURRENT BOTTLENECK: The campaign has a "${bottleneck}" problem. Prioritize the framework most likely to fix it.`
    : 'No specific bottleneck identified. Use balanced frameworks.';

  const platformRules = platform === 'google_ads'
    ? 'Platform: Google Ads. Headlines MUST be ≤30 characters. Descriptions MUST be ≤90 characters. Keep body concise.'
    : 'Platform: Meta (Facebook/Instagram). Headlines can be longer. Body can be 2-4 short paragraphs. Use emojis strategically.';

  const system = `You are a direct-response copywriter specializing in Israeli digital advertising.
You write high-converting ad copy in Hebrew for Israeli audiences.
You always respond with valid JSON only — no markdown, no explanation outside the JSON.

Rules:
- All text output (headline, body, cta, platform_note) MUST be in Hebrew.
- Each variant uses a different psychological framework.
- Keep copy specific to the business — use actual product name, audience, and benefit.
- CTA must match the campaign goal (${bp.primary_goal || 'leads'}).
- ${platformRules}`;

  const user = `Business context:
- Offer: ${bp.offer || 'לא צוין'}
- Price: ₪${bp.price_amount || 'לא צוין'}
- Target audience: ${bp.target_audience || 'לא צוין'}
- Problem solved: ${bp.problem_solved || 'לא צוין'}
- Desired outcome: ${bp.desired_outcome || 'לא צוין'}
- Unique mechanism: ${bp.unique_mechanism || bp.offer || 'לא צוין'}
- Main promise: ${bp.main_promise || bp.desired_outcome || 'לא צוין'}
- Campaign goal: ${bp.primary_goal || 'leads'}

${bottleneckContext}

Generate exactly 3 ad copy variants using these frameworks (in this priority order):
${frameworkInstructions}

Return JSON in this exact shape:
{
  "variants": [
    {
      "variant": "A",
      "framework": "problem_agitate",
      "hook_type": "פתיחת כאב",
      "headline": "string",
      "body": "string (use \\n for line breaks)",
      "cta": "string",
      "platform_note": "string (one Hebrew sentence about creative/image guidance)"
    },
    { "variant": "B", ... },
    { "variant": "C", ... }
  ]
}`;

  return { system, user, maxTokens: 1200 };
}

module.exports = { buildAdCopyPrompt };
