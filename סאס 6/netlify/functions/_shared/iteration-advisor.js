'use strict';

/**
 * iteration-advisor.js — Phase 4F: Iteration Recommendations
 *
 * Takes bottleneck delta + learning result + current metrics and returns ONE
 * decisive action verdict. Follows the system principle:
 *   לא "אולי" — אלא: עצור / הכפל / שכתב / בדוק וריאציה / תקן דף / נטר
 *
 * Pure function — zero side effects, zero DB calls.
 *
 * Input:
 *   bottleneckDelta  — output of trackBottlenecks()
 *   learningResult   — output of runLearningEngine()
 *   currentMetrics   — merged metrics from analyze-service
 *
 * Output: IterationAction
 *   {
 *     verdict:  'stop' | 'scale' | 'rewrite_creative' | 'fix_landing' |
 *               'test_variation' | 'monitor',
 *     heAction: string (Hebrew — what to do right now),
 *     reason:   string (Hebrew — why this verdict),
 *     urgency:  'critical' | 'high' | 'medium' | 'low',
 *   }
 */

/**
 * buildIterationAction(bottleneckDelta, learningResult, currentMetrics)
 *
 * Decision priority (high → low):
 *   1. Critical decline on 3+ metrics      → stop
 *   2. Persistent CTR bottleneck declining → rewrite_creative
 *   3. Persistent conversion bottleneck    → fix_landing
 *   4. Improving + ROAS ≥ 2               → scale
 *   5. ROAS declining but not critical     → test_variation
 *   6. Default                            → monitor
 */
function buildIterationAction(bottleneckDelta, learningResult, currentMetrics) {
  const bn = bottleneckDelta  || {};
  const lr = learningResult   || {};
  const m  = currentMetrics   || {};

  const stageDelta    = bn.stageDelta            || 'stable';
  const deltas        = bn.deltas                || {};
  const persistentBNs = lr.persistentBottlenecks || [];
  const scoreTrend    = lr.scoreTrend            || 'stable';
  const roas          = m.roas                   || 0;
  const spend         = m.spend                  || 0;
  const dataPoints    = lr.dataPoints            || 0;

  // ── Rule 1: Critical decline ───────────────────────────────────────────────
  // 3 or more metrics declining simultaneously = stop adding budget
  if (stageDelta === 'critical_decline' && spend > 0) {
    return {
      verdict:  'stop',
      heAction: 'עצור — אל תגדיל תקציב. 3 מדדים מרכזיים יורדים בו-זמנית.',
      reason:   'CTR, המרה ו-ROAS יורדים ביחד. הוספת תקציב עכשיו תשרוף כסף על בעיה שטרם אובחנה.',
      urgency:  'critical',
    };
  }

  // ── Rule 2: Persistent CTR bottleneck still declining ─────────────────────
  if (
    persistentBNs.includes('ctr') &&
    deltas.ctr?.direction === 'declining'
  ) {
    return {
      verdict:  'rewrite_creative',
      heAction: `שכתב את הקריאייטיב — בעיית CTR חוזרת ב-${dataPoints || 'מספר'} ניתוחים ועדיין מחמירה.`,
      reason:   'CTR מופיע שוב ושוב כצוואר הבקבוק ועכשיו ממשיך לרדת. הקריאייטיב הקיים לא עובד — אל תמשיך לדחות.',
      urgency:  'high',
    };
  }

  // ── Rule 3: Persistent conversion bottleneck ───────────────────────────────
  if (
    persistentBNs.includes('conversion') &&
    deltas.convRate?.direction !== 'improving'
  ) {
    return {
      verdict:  'fix_landing',
      heAction: 'תקן את דף הנחיתה — שיעור ההמרה לא משתפר למרות תנועה.',
      reason:   'בעיית המרה חוזרת בניתוחים אחרונים. התנועה מגיעה — הדף לא סוגר. צוואר הבקבוק הוא לאחר הקליק.',
      urgency:  'high',
    };
  }

  // ── Rule 4: Improving trend + ROAS positive → scale ───────────────────────
  if (scoreTrend === 'improving' && roas >= 2) {
    return {
      verdict:  'scale',
      heAction: `הגדל תקציב ב-20% — הביצועים משתפרים ו-ROAS עומד על ${roas.toFixed(2)}x.`,
      reason:   'ציון כללי עולה לאורך זמן ו-ROAS חיובי. זה הזמן לסקייל מבוקר לפני שהמגמה משתנה.',
      urgency:  'medium',
    };
  }

  // ── Rule 5: ROAS declining (slow) → test new variable ─────────────────────
  if (deltas.roas?.direction === 'declining') {
    return {
      verdict:  'test_variation',
      heAction: 'בדוק וריאציה חדשה — ROAS יורד אבל אין קריסה. אל תמתין יותר מדי.',
      reason:   'ROAS מדרדר לאט. לא חירום, אבל צריך לבדוק מסר אחד אחד עד שמוצאים מה שובר את הירידה.',
      urgency:  'medium',
    };
  }

  // ── Default: monitor ────────────────────────────────────────────────────────
  return {
    verdict:  'monitor',
    heAction: 'המשך לנטר — אין שינוי מובהק כרגע.',
    reason:   'הנתונים יציבים ואין בעיה חוזרת דומיננטית. המתן לסבב הבא לפני שמחליטים.',
    urgency:  'low',
  };
}

module.exports = { buildIterationAction };
