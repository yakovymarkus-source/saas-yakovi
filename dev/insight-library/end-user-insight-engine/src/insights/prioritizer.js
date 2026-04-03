'use strict';

const severityScore = {
  critical: 400,
  high: 300,
  medium: 200,
  low: 100,
};

function rankInsights(insights) {
  return [...insights].sort((a, b) => {
    const severityDelta = (severityScore[b.severity] || 0) - (severityScore[a.severity] || 0);
    if (severityDelta !== 0) return severityDelta;

    const priorityDelta = (a.priority || 999) - (b.priority || 999);
    if (priorityDelta !== 0) return priorityDelta;

    const confidenceDelta = (b.confidence || 0) - (a.confidence || 0);
    if (confidenceDelta !== 0) return confidenceDelta;

    return String(a.id || '').localeCompare(String(b.id || ''));
  });
}

function splitInsights(insights, maxSecondary = 2) {
  const ranked = rankInsights(insights);
  return {
    primary_insight: ranked[0] || null,
    secondary_insights: ranked.slice(1, 1 + maxSecondary),
    lower_priority_insights: ranked.slice(1 + maxSecondary),
  };
}

module.exports = { rankInsights, splitInsights };
