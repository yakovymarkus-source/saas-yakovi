'use strict';

/**
 * prompt-builders/iteration-advice.js — Iteration Advice Prompt Builder
 *
 * Replaces the hardcoded heAction strings in iteration-advisor.js.
 * The advisor's decision tree (WHAT verdict) is kept — it's correct signal math.
 * This prompt builder asks OpenAI to explain HOW to act on that verdict,
 * with context-specific Hebrew reasoning.
 *
 * Expected OpenAI output:
 * {
 *   action:       string,  (short Hebrew imperative — what to do)
 *   reason:       string,  (one sentence Hebrew — why THIS action for THIS campaign)
 *   steps:        string[], (2-4 Hebrew bullet points — concrete steps)
 *   urgency:      'critical' | 'high' | 'medium' | 'low',
 *   time_horizon: string   (e.g. "עשה זאת היום", "השבוע הקרוב", "תוך 7 ימים")
 * }
 */

const VERDICT_CONTEXT = {
  stop:             'The campaign is burning budget with critical performance decline across 3+ metrics. Must stop immediately.',
  rewrite_creative: 'CTR has declined persistently over multiple analysis cycles. The creative (ad copy/image) is fatigued.',
  fix_landing:      'Conversion rate is persistently low while CTR is acceptable. The landing page is the bottleneck.',
  scale:            'Performance is improving and ROAS >= 2x. This is the moment to scale budget.',
  test_variation:   'Performance is declining but not critically. A controlled A/B test is the appropriate next step.',
  monitor:          'Performance is stable. No action needed — continue monitoring.',
};

/**
 * buildIterationAdvicePrompt({ verdict, bottleneckDelta, currentMetrics, businessProfile })
 */
function buildIterationAdvicePrompt({ verdict, bottleneckDelta, currentMetrics, businessProfile }) {
  const bp      = businessProfile || {};
  const metrics = currentMetrics  || {};
  const delta   = bottleneckDelta  || {};

  const verdictContext = VERDICT_CONTEXT[verdict] || `The system recommends: ${verdict}`;

  const metricsStr = [
    metrics.roas    != null ? `ROAS: ${metrics.roas.toFixed(2)}x` : null,
    metrics.ctr     != null ? `CTR: ${((metrics.ctr || 0) * 100).toFixed(2)}%` : null,
    metrics.convRate != null ? `Conv: ${((metrics.convRate || 0) * 100).toFixed(2)}%` : null,
    metrics.spend   != null ? `Spend: ₪${metrics.spend.toFixed(0)}` : null,
  ].filter(Boolean).join(', ');

  const trendStr = delta.stageDelta
    ? `Trend: ${delta.stageDelta} | Primary stage: ${delta.primaryStage || 'none'}`
    : 'No trend data';

  const businessContext = bp.offer
    ? `Business: ${bp.offer}. Goal: ${bp.primary_goal || 'leads'}. Price: ₪${bp.price_amount || 'unknown'}.`
    : 'No business profile.';

  const system = `You are a senior campaign strategist advising an Israeli business owner.
The system has already determined WHAT to do based on data signals.
Your job is to explain HOW to execute that decision — specifically, concretely, in Hebrew.
You always respond with valid JSON only.
All string values MUST be in Hebrew.`;

  const user = `System verdict: "${verdict}"
Verdict context: ${verdictContext}

Current metrics: ${metricsStr || 'Not available'}
${trendStr}
${businessContext}

Generate a specific, actionable execution plan for this verdict:
{
  "action": "Short Hebrew imperative (5-8 words max) — the main action to take",
  "reason": "One Hebrew sentence explaining WHY this action is right for this specific campaign now",
  "steps": [
    "Hebrew step 1 — concrete and specific",
    "Hebrew step 2",
    "Hebrew step 3 (optional)",
    "Hebrew step 4 (optional)"
  ],
  "urgency": "critical" | "high" | "medium" | "low",
  "time_horizon": "Hebrew phrase — when to do this (e.g. 'עשה זאת היום', 'השבוע הקרוב')"
}

Be specific to the metrics and business type. Do not give generic advice.`;

  return { system, user, maxTokens: 600 };
}

module.exports = { buildIterationAdvicePrompt };
