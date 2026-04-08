'use strict';

/**
 * prompt-builders/landing-page.js — Landing Page Structure Prompt Builder
 *
 * Builds prompts for the landing_page capability → routed to Claude.
 * Claude generates structured long-form persuasive page content.
 *
 * Expected output:
 * {
 *   page_title: string,
 *   sections: [
 *     {
 *       type:      'hero' | 'problem' | 'solution' | 'social_proof' | 'offer' | 'faq' | 'cta',
 *       headline:  string,
 *       body:      string,
 *       cta_text:  string | null,
 *       notes:     string | null   (design/layout guidance)
 *     },
 *     ...
 *   ],
 *   seo_title:       string,
 *   seo_description: string,
 * }
 */

/**
 * buildLandingPagePrompt({ businessProfile, adCopy, targetKeyword })
 */
function buildLandingPagePrompt({ businessProfile = {}, adCopy = null, targetKeyword = null }) {
  const bp = businessProfile;

  // If an ad copy variant exists, use it as the message-match anchor
  const adCopyContext = adCopy
    ? `The landing page must match this ad copy (message continuity is critical):
  Headline: ${adCopy.headline}
  Body hook: ${adCopy.body?.split('\n')[0] || ''}
  CTA: ${adCopy.cta}`
    : 'No specific ad copy provided — design for general conversion.';

  const goalCTAMap = {
    leads:        'השאר פרטים / קבל הצעה',
    sales:        'רכוש עכשיו / הזמן היום',
    appointments: 'קבע פגישה חינם',
    awareness:    'גלה עוד',
  };
  const primaryCTA = goalCTAMap[bp.primary_goal] || 'צור קשר';

  const system = `You are a conversion rate optimizer and direct-response copywriter.
You build high-converting Israeli landing pages in Hebrew.
You understand Israeli consumer psychology and writing conventions.
You ALWAYS return valid JSON only — no markdown fences, no explanation outside JSON.
All content strings MUST be in Hebrew.`;

  const user = `Build a complete landing page structure for:

Business: ${bp.offer || 'לא צוין'}
Price: ₪${bp.price_amount || 'לא צוין'} (${bp.pricing_model || 'one_time'})
Target audience: ${bp.target_audience || 'לא צוין'}
Problem solved: ${bp.problem_solved || 'לא צוין'}
Desired outcome: ${bp.desired_outcome || 'לא צוין'}
Unique mechanism: ${bp.unique_mechanism || 'לא צוין'}
Main promise: ${bp.main_promise || bp.desired_outcome || 'לא צוין'}
Primary CTA goal: ${bp.primary_goal || 'leads'} → use CTA text like "${primaryCTA}"
${targetKeyword ? `Target keyword: ${targetKeyword}` : ''}

${adCopyContext}

Return this JSON structure:
{
  "page_title": "Hebrew page title (H1)",
  "seo_title": "Hebrew SEO title (under 60 chars)",
  "seo_description": "Hebrew meta description (under 155 chars)",
  "sections": [
    {
      "type": "hero",
      "headline": "Main headline — the promise",
      "body": "2-3 sentences. Why this matters right now.",
      "cta_text": "Primary CTA button text",
      "notes": "Design note: full-screen with background image"
    },
    {
      "type": "problem",
      "headline": "Agitate the pain",
      "body": "3-5 bullet points describing the painful problem",
      "cta_text": null,
      "notes": "Dark background, emotional tone"
    },
    {
      "type": "solution",
      "headline": "Introduce the solution",
      "body": "Explain the mechanism — how it works, why it's different",
      "cta_text": null,
      "notes": null
    },
    {
      "type": "social_proof",
      "headline": "Results and testimonials",
      "body": "Placeholder structure for 2-3 testimonials with result metrics",
      "cta_text": null,
      "notes": "Use real customer photos if available"
    },
    {
      "type": "offer",
      "headline": "The offer — make it clear",
      "body": "Price, what's included, guarantee",
      "cta_text": "CTA button text",
      "notes": "Highlight price anchoring if relevant"
    },
    {
      "type": "faq",
      "headline": "שאלות נפוצות",
      "body": "3-4 Q&A pairs addressing the top objections for this offer",
      "cta_text": null,
      "notes": null
    },
    {
      "type": "cta",
      "headline": "Final CTA — urgency or scarcity",
      "body": "1-2 sentences reinforcing the decision",
      "cta_text": "${primaryCTA}",
      "notes": "Sticky bar on mobile"
    }
  ]
}`;

  return { system, user, maxTokens: 2000 };
}

module.exports = { buildLandingPagePrompt };
