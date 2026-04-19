'use strict';
/**
 * execution/output/qa-handoff.js
 * Prepares the QA handoff package.
 * Summary of what was built, what needs review, and what's flagged.
 */

function buildQaHandoff({ brief, bundle, ranking, selfFeedback, decisionExplanation, conflictResult, consistencyResult, warnings }) {
  const { selectedPain, executionMode, platform, assetTypes } = brief;

  // ── Flagged Items ─────────────────────────────────────────────────────────
  const flagged = [];

  // Conflicts detected before generation
  for (const conflict of (conflictResult?.conflicts || [])) {
    flagged.push({ source: 'conflict_detector', severity: conflict.severity, message: conflict.description, fix: conflict.fix });
  }

  // Consistency issues across assets
  for (const issue of (consistencyResult?.issues || [])) {
    flagged.push({ source: 'consistency_check', severity: issue.severity, message: issue.message, fix: issue.fix });
  }

  // Self-feedback issues
  if (selfFeedback && !selfFeedback.approved) {
    flagged.push({ source: 'self_feedback', severity: 'warning', message: `Quality score: ${selfFeedback.overall_score}/100 — ${selfFeedback.top_issue}`, fix: selfFeedback.quick_win });
  }

  // Repetition warnings from bundler
  if (bundle?._adRepetitionWarnings?.length > 0) {
    for (const w of bundle._adRepetitionWarnings) {
      flagged.push({ source: 'anti_repetition', severity: 'warning', message: w.message });
    }
  }

  // ── Test Checklist ────────────────────────────────────────────────────────
  const testChecklist = _buildTestChecklist({ bundle, assetTypes, platform });

  // ── QA Summary ────────────────────────────────────────────────────────────
  const hasErrors   = flagged.some(f => f.severity === 'error');
  const hasWarnings = flagged.some(f => f.severity === 'warning');

  const status = hasErrors ? 'NEEDS_REVISION' : hasWarnings ? 'REVIEW_RECOMMENDED' : 'APPROVED';

  return {
    status,
    flagged,
    testChecklist,
    selfFeedbackScores: selfFeedback?.scores || null,
    overallQualityScore: selfFeedback?.overall_score || null,
    decisionExplanation: decisionExplanation || null,
    topRecommendation:  ranking?.recommendation || null,
    summary: {
      totalFlagged: flagged.length,
      errors:       flagged.filter(f => f.severity === 'error').length,
      warnings:     flagged.filter(f => f.severity === 'warning').length,
      assetCount:   bundle?.summary?.totalAssets || 0,
      readyForQa:   !hasErrors,
    },
    warnings: warnings || [],
  };
}

function _buildTestChecklist({ bundle, assetTypes, platform }) {
  const items = [];

  if (assetTypes.includes('ads')) {
    items.push({ item: 'בדוק שכל מודעה עוברת את מדיניות הפלטפורמה', done: false, critical: true });
    items.push({ item: `ודא שה-CTA תואם את גבול התווים של ${platform}`, done: false, critical: false });
    items.push({ item: 'בדוק שהוויזואל מותאם לפורמט הנכון', done: false, critical: true });
  }

  if (assetTypes.includes('landing_page')) {
    items.push({ item: 'בדוק שדף הנחיתה נטען מהיר (< 3 שניות)', done: false, critical: true });
    items.push({ item: 'ודא שהטפסים עובדים ומחוברים ל-CRM', done: false, critical: true });
    items.push({ item: 'בדוק responsive על מובייל', done: false, critical: true });
    items.push({ item: 'ודא שה-tracking events מוטמעים (Pixel, GA)', done: false, critical: false });
  }

  if (assetTypes.includes('email')) {
    items.push({ item: 'בדוק SPF/DKIM/DMARC לדומיין השולח', done: false, critical: true });
    items.push({ item: 'ודא שקישורי unsubscribe עובדים', done: false, critical: true });
    items.push({ item: 'בדוק תצוגה ב-Gmail, Outlook, Apple Mail', done: false, critical: false });
  }

  if (assetTypes.includes('scripts')) {
    items.push({ item: 'בדוק שהסקריפט מותאם לאורך הסרטון', done: false, critical: false });
    items.push({ item: 'ודא שיש subtitles/כיתובים', done: false, critical: false });
  }

  // General
  items.push({ item: 'בדוק שכל הנכסים מפנים לאותו URL', done: false, critical: true });
  items.push({ item: 'ודא עקביות ויזואלית בין הנכסים', done: false, critical: false });

  return items;
}

module.exports = { buildQaHandoff };
