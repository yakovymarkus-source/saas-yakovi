'use strict';

const { DISPLAY_MODES, SEVERITIES, USER_LEVELS } = require('./types');
const { CONTRACT_VERSION } = require('../contract');

function isString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function ensureArray(value, fieldName) {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array`);
  }
}

function ensureNoNullOrUndefined(value, fieldPath, options = {}) {
  const { allowNull = false } = options;

  if (value === undefined) {
    throw new Error(`${fieldPath} must not be undefined`);
  }

  if (value === null) {
    if (allowNull) {
      return;
    }

    throw new Error(`${fieldPath} must not be null`);
  }

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      ensureNoNullOrUndefined(value[index], `${fieldPath}[${index}]`);
    }
    return;
  }

  if (typeof value === 'object') {
    for (const [key, nestedValue] of Object.entries(value)) {
      ensureNoNullOrUndefined(nestedValue, `${fieldPath}.${key}`);
    }
  }
}

function validateInsight(insight) {
  const errors = [];

  if (!insight || typeof insight !== 'object' || Array.isArray(insight)) {
    throw new Error('Insight must be an object');
  }

  ensureNoNullOrUndefined(insight, 'insight');

  const requiredStringFields = [
    'id',
    'title',
    'explanation',
    'severity',
    'action',
    'issue_code',
    'professional_label',
    'simple_label',
    'simple_summary',
    'business_impact',
    'first_action',
    'user_level',
    'display_mode',
  ];

  for (const field of requiredStringFields) {
    if (!isString(insight[field])) {
      errors.push(`Invalid or missing ${field}`);
    }
  }

  if (!SEVERITIES.includes(insight.severity)) {
    errors.push('Invalid severity');
  }

  if (!USER_LEVELS.includes(insight.user_level)) {
    errors.push('Invalid user_level');
  }

  if (!DISPLAY_MODES.includes(insight.display_mode)) {
    errors.push('Invalid display_mode');
  }

  if (!Array.isArray(insight.likely_causes) || insight.likely_causes.length === 0) {
    errors.push('likely_causes must be a non-empty array');
  }

  if (typeof insight.confidence !== 'number' || Number.isNaN(insight.confidence)) {
    errors.push('confidence must be a valid number');
  }

  if (typeof insight.priority !== 'number' || Number.isNaN(insight.priority)) {
    errors.push('priority must be a valid number');
  }

  if (!insight.learn_more || !isString(insight.learn_more.term) || !isString(insight.learn_more.definition)) {
    errors.push('learn_more must include term and definition');
  }

  if (errors.length > 0) {
    const error = new Error(`Insight validation failed: ${errors.join('; ')}`);
    error.validationErrors = errors;
    throw error;
  }

  return insight;
}

function validateFinalBundle(bundle) {
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
    throw new Error('Final bundle must be an object');
  }

  const requiredArrayFields = [
    'all_insights',
    'primary_insights',
    'secondary_insights',
    'low_priority_insights',
    'lower_priority_insights',
    'skipped_insights',
  ];

  for (const field of requiredArrayFields) {
    ensureArray(bundle[field], field);
  }

  if (!bundle.meta || typeof bundle.meta !== 'object' || Array.isArray(bundle.meta)) {
    throw new Error('meta must be an object');
  }

  const bundleFieldsToCheck = [
    'all_insights',
    'primary_insights',
    'secondary_insights',
    'low_priority_insights',
    'lower_priority_insights',
    'skipped_insights',
    'meta',
  ];

  for (const field of bundleFieldsToCheck) {
    ensureNoNullOrUndefined(bundle[field], `bundle.${field}`);
  }

  if (bundle.primary_insight !== null) {
    ensureNoNullOrUndefined(bundle.primary_insight, 'bundle.primary_insight');
  }

  if (bundle.primary_insight !== null && (typeof bundle.primary_insight !== 'object' || Array.isArray(bundle.primary_insight))) {
    throw new Error('primary_insight must be an object or null');
  }

  for (const insight of bundle.all_insights) {
    validateInsight(insight);
  }

  for (const insight of bundle.primary_insights) {
    validateInsight(insight);
  }

  for (const insight of bundle.secondary_insights) {
    validateInsight(insight);
  }

  for (const insight of bundle.low_priority_insights) {
    validateInsight(insight);
  }

  for (const insight of bundle.lower_priority_insights) {
    validateInsight(insight);
  }

  for (const skipped of bundle.skipped_insights) {
    if (!skipped || typeof skipped !== 'object' || !isString(skipped.issue_code) || !isString(skipped.reason)) {
      throw new Error('Each skipped insight must include issue_code and reason');
    }
    ensureNoNullOrUndefined(skipped, 'bundle.skipped_insights[]');
  }

  if (bundle.low_priority_insights.length !== bundle.lower_priority_insights.length) {
    throw new Error('low_priority_insights and lower_priority_insights must stay aligned');
  }

  if (typeof bundle.meta.total_input !== 'number' || Number.isNaN(bundle.meta.total_input)) {
    throw new Error('meta.total_input must be a number');
  }

  if (typeof bundle.meta.total_processed !== 'number' || Number.isNaN(bundle.meta.total_processed)) {
    throw new Error('meta.total_processed must be a number');
  }

  if (typeof bundle.meta.total_skipped !== 'number' || Number.isNaN(bundle.meta.total_skipped)) {
    throw new Error('meta.total_skipped must be a number');
  }

  if (bundle.meta.total_processed !== bundle.all_insights.length) {
    throw new Error('meta.total_processed must match all_insights length');
  }

  if (bundle.meta.total_skipped !== bundle.skipped_insights.length) {
    throw new Error('meta.total_skipped must match skipped_insights length');
  }

  if (!isString(bundle.meta.user_level)) {
    throw new Error('meta.user_level must be a string');
  }

  if (!isString(bundle.meta.display_mode)) {
    throw new Error('meta.display_mode must be a string');
  }

  if (!isString(bundle.meta.business_type)) {
    throw new Error('meta.business_type must be a string');
  }

  if (!isString(bundle.meta.contract_version)) {
    throw new Error('meta.contract_version must be a string');
  }

  if (bundle.meta.contract_version !== CONTRACT_VERSION) {
    throw new Error('meta.contract_version must match package contract version');
  }

  if (bundle.primary_insights.length === 0) {
    if (bundle.primary_insight !== null) {
      throw new Error('primary_insight must be null when primary_insights is empty');
    }
  } else {
    validateInsight(bundle.primary_insights[0]);

    if (bundle.primary_insight === null) {
      throw new Error('primary_insight must exist when primary_insights is not empty');
    }

    validateInsight(bundle.primary_insight);

    if (bundle.primary_insight.id !== bundle.primary_insights[0].id) {
      throw new Error('primary_insight must match first primary_insights item');
    }
  }

  return bundle;
}

module.exports = { validateInsight, validateFinalBundle };
