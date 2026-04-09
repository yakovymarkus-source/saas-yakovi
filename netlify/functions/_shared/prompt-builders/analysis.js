'use strict';

/**
 * prompt-builders/analysis.js — Analysis Summary Prompt Builder
 *
 * Builds prompts for the analysis_summary capability.
 * Takes raw metrics + scores + bottlenecks from the existing decision engine
 * (which correctly identifies WHAT is wrong) and asks OpenAI to explain
 * WHY it matters and WHAT to do — in contextual, business-specific Hebrew.
 *
 * Expected OpenAI output:
 * {
 *   main_finding:    string,
 *   verdict:         'healthy' | 'needs_work' | 'critical',
 *   recommendations: [
 *     { priority: 1, issue: string, root_cause: string, action: string, expected_impact: string },
 *     ...up to 3
 *   ],
 *   confidence:      number (0-1),
 *   urgency:         'low' | 'medium' | 'high' | 'critical'
 * }
 */

/**
 * buildAnalysisPrompt({ metrics, scores, bottlenecks, decisions, businessProfile })
 */
function buildAnalysisPrompt({ metrics, scores, bottlenecks, decisions, businessProfile }) {
  const bp = businessProfile || {};

  const metricsStr = [
    `CTR: ${((metrics.ctr || 0) * 100).toFixed(2)}%`,
    `Conv Rate: ${((metrics.convRate || 0) * 100).toFixed(2)}%`,
    `ROAS: ${metrics.roas ? metrics.roas.toFixed(2) + 'x' : 'N/A'}`,
    `CPC: ₪${(metrics.cpc || 0).toFixed(2)}`,
    `Spend: ₪${(metrics.spend || 0).toFixed(0)}`,
    `Conversions: ${metrics.conversions || 0}`,
    `Impressions: ${(metrics.impressions || 0).toLocaleString()}`,
  ].join(', ');

  const scoresStr = `Overall: ${scores.overall}/100, CTR score: ${scores.ctr}/100, Conv score: ${scores.conversion}/100, ROAS score: ${scores.roas}/100`;

  const bottleneckStr = bottlenecks.length > 0
    ? `Active bottlenecks: ${bottlenecks.join(', ')}`
    : 'No critical bottlenecks detected';

  const verdictContext = decisions?.[0]?.verdict || 'unknown';

  const businessContext = bp.offer
    ? `Business: ${bp.offer}. Audience: ${bp.target_audience || 'general'}. Goal: ${bp.primary_goal || 'leads'}. Price: ₪${bp.price_amount || 'unknown'}.`
    : 'No business profile available — analyze based on metrics only.';

  const system = `You are a senior campaign performance analyst advising Israeli business owners.
You analyze paid advertising data and provide clear, actionable Hebrew recommendations.
You always respond with valid JSON only.

Rules:
- All string values in your JSON output MUST be in Hebrew.
- Be specific — reference actual metric values in your analysis.
- Prioritize by business impact, not by metric aesthetics.
- If data is insufficient, say so clearly.`;

  const user = `Campaign performance data:
Metrics: ${metricsStr}
Scores: ${scoresStr}
${bottleneckStr}
System verdict: ${verdictContext}
${businessContext}

Analyze this campaign and return:
{
  "main_finding": "One sentence in Hebrew summarizing the most important insight",
  "verdict": "healthy" | "needs_work" | "critical",
  "urgency": "low" | "medium" | "high" | "critical",
  "confidence": 0.0-1.0,
  "recommendations": [
    {
      "priority": 1,
      "issue": "Hebrew — what is the problem",
      "root_cause": "Hebrew — why is this happening",
      "action": "Hebrew — specific thing to do THIS WEEK",
      "expected_impact": "Hebrew — what will change and by how much"
    }
  ]
}

Provide 1-3 recommendations ordered by priority. Do not invent data not in the input.`;

  return { system, user, maxTokens: 1000 };
}

module.exports = { buildAnalysisPrompt };
