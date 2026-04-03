'use strict';

const { buildInsights } = require('../insights/insightEngine');
const { validateFinalBundle } = require('../insights/validator');

function attachInsightsToAnalysis(analysisResult, context = {}) {
  if (!analysisResult || typeof analysisResult !== 'object') {
    throw new Error('analysisResult must be an object');
  }

  const rawIssues = Array.isArray(analysisResult.issues)
    ? analysisResult.issues
    : Array.isArray(analysisResult.findings)
      ? analysisResult.findings
      : [];

  const insightBundle = validateFinalBundle(buildInsights(rawIssues, context));

  return {
    ...analysisResult,
    translated_insights: {
      ...insightBundle,
    },
  };
}

module.exports = { attachInsightsToAnalysis };
