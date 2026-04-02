'use strict';

const explanationEngine = require('./explanationEngine');
const { splitInsights } = require('./prioritizer');
const validator = require('./validator');
const { CONTRACT_VERSION } = require('../contract');

function normalizeIssue(rawIssue, index) {
  if (!rawIssue || typeof rawIssue !== 'object' || Array.isArray(rawIssue)) {
    return null;
  }

  const issueCode = rawIssue.issue_code || rawIssue.code;
  if (typeof issueCode !== 'string' || issueCode.trim().length === 0) {
    return null;
  }

  return {
    issue_code: issueCode,
    severity: rawIssue.severity || 'medium',
    confidence: typeof rawIssue.confidence === 'number' ? rawIssue.confidence : 0.5,
    priority_rank: typeof rawIssue.priority_rank === 'number' ? rawIssue.priority_rank : index + 1,
    metrics: rawIssue.metrics && typeof rawIssue.metrics === 'object' ? rawIssue.metrics : null,
  };
}

function toIssueKey(issue) {
  const metricsKey = issue.metrics && typeof issue.metrics === 'object'
    ? JSON.stringify(Object.keys(issue.metrics).sort().reduce((acc, key) => {
      acc[key] = issue.metrics[key];
      return acc;
    }, {}))
    : '';

  return [
    issue.issue_code,
    issue.severity,
    issue.confidence,
    issue.priority_rank,
    metricsKey,
  ].join('|');
}

function normalizeRawIssues(rawIssues) {
  if (!Array.isArray(rawIssues) || rawIssues.length === 0) {
    return [];
  }

  const deduped = [];
  const seen = new Set();

  for (let index = 0; index < rawIssues.length; index += 1) {
    const normalized = normalizeIssue(rawIssues[index], index);
    if (!normalized) continue;

    const key = toIssueKey(normalized);
    if (seen.has(key)) continue;

    seen.add(key);
    deduped.push(normalized);
  }

  return deduped;
}

function buildInsights(rawIssues = [], context = {}) {
  const normalizedIssues = normalizeRawIssues(rawIssues);
  const translated = [];
  const skipped = [];

  for (let index = 0; index < normalizedIssues.length; index += 1) {
    const normalizedIssue = normalizedIssues[index];

    try {
      translated.push(validator.validateInsight(explanationEngine.buildExplanation(normalizedIssue, context)));
    } catch (error) {
      skipped.push({
        issue_code: normalizedIssue.issue_code,
        reason: error.message,
      });
    }
  }

  const grouped = splitInsights(translated);
  const bundle = {
    primary_insight: grouped.primary_insight,
    primary_insights: grouped.primary_insight ? [grouped.primary_insight] : [],
    secondary_insights: grouped.secondary_insights,
    low_priority_insights: grouped.lower_priority_insights,
    lower_priority_insights: grouped.lower_priority_insights,
    all_insights: translated,
    skipped_insights: skipped,
    meta: {
      total_input: Array.isArray(rawIssues) ? rawIssues.length : 0,
      total_normalized: normalizedIssues.length,
      total_processed: translated.length,
      total_skipped: skipped.length,
      user_level: context.user_level || 'beginner',
      display_mode: context.display_mode || 'simple',
      business_type: explanationEngine.normalizeBusinessType(context.business_type),
      deterministic_ordering: true,
      contract_version: CONTRACT_VERSION,
    },
  };

  return validator.validateFinalBundle(bundle);
}

module.exports = { buildInsights, normalizeIssue, normalizeRawIssues };
