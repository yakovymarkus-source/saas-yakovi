'use strict';

/**
 * prompt-builders/issue-explanation.js — Issue Explanation Prompt Builder
 *
 * Replaces explanationEngine.js + templates.js + dictionary.js as content source.
 * The dictionary data becomes INPUT context (not output), feeding richer AI explanations.
 *
 * Expected OpenAI output:
 * {
 *   title:           string,  (simple Hebrew label)
 *   explanation:     string,  (2-3 sentence plain Hebrew explanation)
 *   business_impact: string,  (what this means for THIS business specifically)
 *   likely_causes:   string[], (2-3 Hebrew bullet points)
 *   first_action:    string,  (the single most important thing to do NOW)
 *   learn_more:      { term: string, definition: string }
 * }
 */

const { dictionary } = require('../dictionary');

/**
 * buildIssueExplanationPrompt({ issueCode, metrics, businessProfile, userLevel })
 */
function buildIssueExplanationPrompt({ issueCode, metrics, businessProfile, userLevel = 'beginner' }) {
  const bp        = businessProfile || {};
  const dictEntry = dictionary[issueCode] || null;

  // Use dictionary as context enrichment — it describes known patterns
  const dictContext = dictEntry
    ? `Known pattern context for "${issueCode}":
  - Professional label: ${dictEntry.professional_label}
  - Likely causes: ${(dictEntry.likely_causes || []).join('; ')}
  - Standard first action: ${dictEntry.first_action}`
    : `No known pattern for "${issueCode}" — reason from the metrics provided.`;

  const metricsStr = metrics
    ? Object.entries(metrics)
        .filter(([, v]) => v !== null && v !== undefined)
        .map(([k, v]) => `${k}: ${typeof v === 'number' ? v.toFixed(3) : v}`)
        .join(', ')
    : 'No metrics provided';

  const businessContext = bp.offer
    ? `Business: ${bp.offer}. Type: ${bp.category || 'unknown'}. Goal: ${bp.primary_goal || 'leads'}. Price: ₪${bp.price_amount || 'unknown'}.`
    : 'No business profile — explain generically.';

  const toneInstruction = userLevel === 'advanced'
    ? 'Use professional marketing terminology. Be precise and data-driven.'
    : 'Explain as if to a business owner who is new to digital advertising. No jargon. Plain language.';

  const system = `You are a digital marketing expert explaining campaign issues to Israeli business owners.
You always respond with valid JSON only.
${toneInstruction}
All string values in your JSON output MUST be in Hebrew.`;

  const user = `Issue detected: "${issueCode}"

Current metrics: ${metricsStr}
${dictContext}
${businessContext}

Explain this issue and return:
{
  "title": "3-5 word Hebrew label for this issue",
  "explanation": "2-3 sentence Hebrew explanation of what is happening and why it matters",
  "business_impact": "One sentence in Hebrew explaining the specific business consequence for this type of business",
  "likely_causes": ["Hebrew cause 1", "Hebrew cause 2", "Hebrew cause 3"],
  "first_action": "One specific Hebrew sentence: the single most important thing to do this week",
  "learn_more": {
    "term": "The technical term in English",
    "definition": "One Hebrew sentence defining the term simply"
  }
}`;

  return { system, user, maxTokens: 700 };
}

module.exports = { buildIssueExplanationPrompt };
