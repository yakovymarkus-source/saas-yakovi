'use strict';

const { dictionary } = require('./dictionary');
const { buildPatternTemplate } = require('./templates');

function normalizeBusinessType(input) {
  if (!input) return 'generic';
  if (['services', 'ecommerce', 'lead_generation', 'generic'].includes(input)) return input;
  return 'generic';
}

function normalizeSeverity(input) {
  if (!input) return 'medium';
  const value = String(input).toLowerCase();
  if (['low', 'medium', 'high', 'critical'].includes(value)) return value;
  return 'medium';
}

function safeFallback(issue) {
  const code = String(issue?.issue_code || issue?.code || 'unknown_issue');
  return {
    professional_label: code,
    simple_label: 'יש כאן נקודה שדורשת בדיקה',
    simple_summary: 'המערכת זיהתה סימן לבעיה, אבל לא מדובר בתבנית מוכרת מספיק כדי לתת אבחון חד יותר.',
    business_impact: {
      generic: 'כנראה שיש כאן משהו שפוגע בביצועים או מקשה על קבלת החלטות.'
    },
    likely_causes: [
      'יש חריגה בנתונים.',
      'יש חולשה מקומית במשפך.',
      'חסר הקשר מלא כדי לדייק את הסיבה.'
    ],
    first_action: 'בדוק קודם את השלב שבו הביצועים ירדו בצורה החדה ביותר.',
    learn_more: {
      term: code,
      definition: 'סימון פנימי לבעיה שדורשת בדיקה נוספת.'
    },
    meta: {
      fallback_mode: 'safe_fallback'
    }
  };
}

function pickSource(issue) {
  const code = String(issue?.issue_code || issue?.code || '').toLowerCase();
  if (dictionary[code]) {
    return { ...dictionary[code], meta: { fallback_mode: 'dictionary' } };
  }

  const templated = buildPatternTemplate(code);
  if (templated) {
    return { ...templated, meta: { fallback_mode: 'template' } };
  }

  return safeFallback(issue);
}

function adaptTone(text, userLevel, displayMode) {
  const clean = String(text || '').trim();
  if (!clean) return clean;

  if (userLevel === 'advanced' && displayMode === 'professional') {
    return clean;
  }

  if (userLevel === 'advanced') {
    return `${clean} בלי להיכנס כרגע לכל שכבות הניתוח.`;
  }

  if (userLevel === 'intermediate') {
    return clean;
  }

  if (displayMode === 'professional') {
    return `${clean} זה הסבר פשוט לגרסה המקצועית.`;
  }

  return clean;
}

function resolveBusinessImpact(template, businessType) {
  const type = normalizeBusinessType(businessType);
  return template.business_impact[type] || template.business_impact.generic || 'יש כאן פגיעה עסקית שדורשת טיפול.';
}

function buildProfessionalLabel(base, issue, context = {}) {
  const code = String(issue?.issue_code || issue?.code || 'unknown_issue').toLowerCase();
  const severity = normalizeSeverity(issue?.severity);
  const businessType = normalizeBusinessType(context.business_type);
  const sourceHint = issue?.metrics && typeof issue.metrics === 'object'
    ? Object.keys(issue.metrics).sort().join('+')
    : '';

  const parts = [String(base || code).trim()];
  parts.push(severity.toUpperCase());

  if (businessType !== 'generic') {
    parts.push(businessType.replace(/_/g, ' ').toUpperCase());
  }

  if (sourceHint) {
    parts.push(sourceHint.toUpperCase());
  }

  return parts.join(' | ');
}

function buildInsightId(code, severity, priority) {
  return `${code}:${severity}:${priority}`;
}

function buildExplanation(issue, context = {}) {
  const code = String(issue?.issue_code || issue?.code || 'unknown_issue').toLowerCase();
  const source = pickSource(issue);
  const userLevel = context.user_level || 'beginner';
  const displayMode = context.display_mode || 'simple';
  const severity = normalizeSeverity(issue?.severity);
  const priority = typeof issue?.priority_rank === 'number' ? issue.priority_rank : 999;

  const simpleLabel = adaptTone(source.simple_label, userLevel, displayMode);
  const simpleSummary = adaptTone(source.simple_summary, userLevel, displayMode);
  const businessImpact = adaptTone(resolveBusinessImpact(source, context.business_type), userLevel, displayMode);
  const likelyCauses = source.likely_causes.map((item) => adaptTone(item, userLevel, displayMode));
  const firstAction = adaptTone(source.first_action, userLevel, displayMode);
  const professionalLabel = buildProfessionalLabel(source.professional_label, issue, context);

  return {
    id: buildInsightId(code, severity, priority),
    issue_code: code,
    title: simpleLabel,
    explanation: simpleSummary,
    action: firstAction,
    severity,
    professional_label: professionalLabel,
    simple_label: simpleLabel,
    simple_summary: simpleSummary,
    business_impact: businessImpact,
    likely_causes: likelyCauses,
    first_action: firstAction,
    learn_more: {
      term: source.learn_more.term,
      definition: adaptTone(source.learn_more.definition, userLevel, displayMode),
    },
    confidence: typeof issue?.confidence === 'number' ? issue.confidence : 0.6,
    priority,
    user_level: userLevel,
    display_mode: displayMode,
    meta: {
      generated_by: 'insight_engine_v1',
      fallback_mode: source.meta?.fallback_mode || 'safe_fallback',
      business_type: normalizeBusinessType(context.business_type),
      internal_metrics: issue?.metrics && typeof issue.metrics === 'object' ? issue.metrics : {},
    }
  };
}

module.exports = {
  buildExplanation,
  normalizeBusinessType,
  normalizeSeverity,
  buildProfessionalLabel,
};
