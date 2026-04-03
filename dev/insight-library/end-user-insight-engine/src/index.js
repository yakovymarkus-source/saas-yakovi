'use strict';

const { buildInsights, normalizeIssue, normalizeRawIssues } = require('./insights/insightEngine');
const { buildExplanation, buildProfessionalLabel, normalizeBusinessType, normalizeSeverity } = require('./insights/explanationEngine');
const { attachInsightsToAnalysis } = require('./integrations/analysisInsightAdapter');
const { validateInsight, validateFinalBundle } = require('./insights/validator');
const { rankInsights, splitInsights } = require('./insights/prioritizer');
const { dictionary } = require('./insights/dictionary');
const { buildPatternTemplate } = require('./insights/templates');
const types = require('./insights/types');
const { CONTRACT_VERSION } = require('./contract');

module.exports = {
  buildInsights,
  normalizeIssue,
  normalizeRawIssues,
  buildExplanation,
  buildProfessionalLabel,
  normalizeBusinessType,
  normalizeSeverity,
  attachInsightsToAnalysis,
  validateInsight,
  validateFinalBundle,
  rankInsights,
  splitInsights,
  dictionary,
  buildPatternTemplate,
  CONTRACT_VERSION,
  ...types,
};
