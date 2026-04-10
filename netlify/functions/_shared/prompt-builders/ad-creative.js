'use strict';

/**
 * prompt-builders/ad-creative.js — Ad Creative Brief Prompt Builder
 *
 * Builds prompts for the ad_creative capability → routed to Claude.
 * Claude generates structured visual briefs for each ad variant.
 *
 * Input: { businessProfile, adCopyVariants, platform }
 *
 * Expected output:
 * {
 *   creatives: [
 *     {
 *       variant:          'A',
 *       format:           'single_image' | 'carousel' | 'video_script' | 'story',
 *       visual_concept:   string,   // what the image/video should show
 *       background:       string,   // background color/style
 *       text_overlay:     string,   // text to overlay on image
 *       color_palette:    string[],  // 2-3 hex colors
 *       mood:             string,   // e.g. "urgent", "aspirational", "trustworthy"
 *       image_prompt:     string,   // ready-to-use prompt for DALL-E / Midjourney
 *       design_notes:     string,   // guidance for designer
 *     },
 *     ...
 *   ]
 * }
 */

/**
 * buildAdCreativePrompt({ businessProfile, adCopyVariants, platform })
 */
function buildAdCreativePrompt({ businessProfile = {}, adCopyVariants = [], platform = 'meta' }) {
  const bp = businessProfile;

  const variantsContext = adCopyVariants.length > 0
    ? adCopyVariants.map((v, i) => `
Variant ${v.variant || String.fromCharCode(65 + i)}:
  Framework: ${v.framework || ''}
  Headline: ${v.headline || ''}
  Body: ${(v.body || '').split('\n')[0]}
  CTA: ${v.cta || ''}
  Platform note: ${v.platform_note || ''}
`).join('\n')
    : 'No ad copy provided — generate creatives based on business profile only.';

  const platformRules = platform === 'google_ads'
    ? 'Platform: Google Display. Square (1:1) and banner (1.91:1) formats. Minimal text. Logo prominent.'
    : platform === 'story'
      ? 'Platform: Instagram/Facebook Stories. Vertical 9:16. Bold text. First frame must hook in 1 second.'
      : 'Platform: Meta (Facebook/Instagram). Primary format: 1:1 or 4:5 feed post. Text overlay maximum 20% of image.';

  const system = `You are a senior creative director specializing in Israeli direct-response digital advertising.
You create visual briefs that translate ad copy into concrete, producible creative assets.
You understand Israeli aesthetics, color psychology, and what visuals convert in Israeli markets.
You ALWAYS return valid JSON only — no markdown, no explanation outside JSON.
All text fields (visual_concept, text_overlay, design_notes) MUST be in Hebrew.
image_prompt must be in English (for AI image generation tools).`;

  const user = `Create visual creative briefs for these ad variants.

Business:
- Product/Offer: ${bp.offer || 'לא צוין'}
- Target audience: ${bp.target_audience || 'לא צוין'}
- Desired outcome: ${bp.desired_outcome || 'לא צוין'}
- Problem solved: ${bp.problem_solved || 'לא צוין'}
- Brand tone: ${bp.brand_tone || 'professional, trustworthy'}

${platformRules}

Ad copy variants to match:
${variantsContext}

For each variant, generate a matching visual creative brief.
Match the emotional tone of the copy — if copy is urgent, creative should feel urgent.
If copy uses pain, visual should show the pain. If copy shows results, visual shows transformation.

Return JSON:
{
  "creatives": [
    {
      "variant": "A",
      "format": "single_image",
      "visual_concept": "תיאור מה התמונה צריכה להראות בעברית",
      "background": "תיאור הרקע בעברית",
      "text_overlay": "הטקסט שיופיע על התמונה",
      "color_palette": ["#hex1", "#hex2", "#hex3"],
      "mood": "urgent / aspirational / trustworthy / bold",
      "image_prompt": "Detailed English prompt for DALL-E or Midjourney to generate this image",
      "design_notes": "הנחיות לדיזיינר בעברית"
    }
  ]
}`;

  return { system, user, maxTokens: 2000 };
}

module.exports = { buildAdCreativePrompt };
