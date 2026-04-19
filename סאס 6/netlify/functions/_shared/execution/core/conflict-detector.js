'use strict';
/**
 * execution/core/conflict-detector.js
 * Detects contradictions before asset generation.
 *   - audience + tone mismatch
 *   - complexity + message length mismatch
 *   - awareness level + CTA type mismatch
 *   - platform + content type mismatch
 *   - method + tone mismatch
 */

function detectConflicts({ brief, awarenessProfile, decisionProfile, messageCore }) {
  const conflicts = [];
  const warnings  = [];

  const { platform, method, tone, productType, executionMode } = brief;
  const methodKey  = method?.primary?.method || '';
  const toneKey    = tone?.tone || '';
  const ctaStrength = awarenessProfile?.behavior?.ctaStrength || 'medium';
  const intensity  = decisionProfile?.intensity || 3;

  // ── Audience + Tone ───────────────────────────────────────────────────────
  if (awarenessProfile?.index <= 0 && toneKey === 'authority') {
    conflicts.push({
      type:        'audience_tone_mismatch',
      severity:    'warning',
      description: 'קהל לא מודע לבעיה + טון סמכותי — הקהל לא יתחבר לסמכות אם הוא לא מודע לבעיה',
      fix:         'עבור לטון empathetic או conversational לקהל unaware',
    });
  }

  // ── Complexity + Message ───────────────────────────────────────────────────
  if (['saas', 'course'].includes(productType) && platform === 'tiktok' && methodKey !== 'educational') {
    warnings.push({
      type:        'complexity_platform_tension',
      severity:    'info',
      description: 'מוצר מורכב על TikTok — הודעות קצרות בלבד, לא ניתן להסביר מוצר SaaS/קורס עמוק',
      fix:         'השתמש ב-hook בלבד ל-awareness, לא מכירה ישירה',
    });
  }

  // ── Awareness + CTA ───────────────────────────────────────────────────────
  if (awarenessProfile?.index <= 0 && ctaStrength === 'urgent') {
    conflicts.push({
      type:        'awareness_cta_mismatch',
      severity:    'error',
      description: 'קהל unaware + CTA אגרסיבי — יגרום לדחייה מיידית',
      fix:         'שנה CTA ל-soft ("גלה עוד") ל-awareness level זה',
    });
  }

  // ── Platform + Content Type ───────────────────────────────────────────────
  if (platform === 'google' && methodKey === 'emotional_story') {
    conflicts.push({
      type:        'platform_method_mismatch',
      severity:    'warning',
      description: 'Google Search + emotional story — אנשים ב-Google מחפשים פתרון, לא סיפור',
      fix:         'שנה ל-direct_response או educational עבור Google',
    });
  }

  if (platform === 'linkedin' && (toneKey === 'conversational' || methodKey === 'emotional_story')) {
    warnings.push({
      type:        'platform_tone_tension',
      severity:    'info',
      description: 'LinkedIn + טון לא פורמלי — הקהל העסקי של LinkedIn מצפה לרמה מקצועית יותר',
      fix:         'שקול לעבור לטון authority או educational ב-LinkedIn',
    });
  }

  // ── Method + Tone ─────────────────────────────────────────────────────────
  if (methodKey === 'direct_response' && toneKey === 'authority') {
    warnings.push({
      type:        'method_tone_tension',
      severity:    'info',
      description: 'direct_response + authority טון — direct_response עובד טוב יותר עם direct/empathetic',
      fix:         'שקול לשנות טון ל-direct',
    });
  }

  // ── Intensity + Awareness mismatch ───────────────────────────────────────
  if (intensity >= 4 && awarenessProfile?.index <= 1) {
    conflicts.push({
      type:        'intensity_awareness_mismatch',
      severity:    'warning',
      description: `Intensity ${intensity} (גבוה) על קהל ב-awareness level ${awarenessProfile?.level} — לחץ גבוה על קהל לא מוכן`,
      fix:         'הפחת intensity ל-2-3 עבור קהל בשלבי awareness מוקדמים',
    });
  }

  // ── Premium mode + draft quality inputs ──────────────────────────────────
  if (executionMode === 'premium' && (brief.confidence || 0) < 50) {
    warnings.push({
      type:        'mode_confidence_mismatch',
      severity:    'info',
      description: 'Premium mode עם confidence נמוך — האסטרטגיה לא בשלה מספיק לפרימיום',
      fix:         'שקול להריץ smart mode במקום',
    });
  }

  const hasBlockingError = conflicts.some(c => c.severity === 'error');

  return {
    conflicts,
    warnings,
    hasBlockingError,
    canProceed: !hasBlockingError,
    totalIssues: conflicts.length + warnings.length,
  };
}

module.exports = { detectConflicts };
