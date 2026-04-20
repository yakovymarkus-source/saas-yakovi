'use strict';
/**
 * analysis/engines/pattern-library.js
 * Recognizes recurring patterns and matches known solutions.
 * Also builds/updates the pattern memory for long-term learning.
 */

// ── Known patterns ─────────────────────────────────────────────────────────────
const KNOWN_PATTERNS = [
  {
    id:          'creative_fatigue',
    name:        'שחיקת קריאייטיב',
    condition:   m => (m.frequency > 3) && (m.ctr < 0.01),
    confidence:  0.88,
    explanation: 'קריאייטיב שנצפה יותר מדי — CTR יורד, תדירות עולה. דפוס קלאסי של שחיקה.',
    solution:    'החלף קריאייטיב לחלוטין. אל תשנה רק צבע — בנה הוק חדש.',
    timeframe:   'השחיקה מתחילה בד"כ אחרי 7-14 ימים ב-Meta',
  },
  {
    id:          'landing_page_mismatch',
    name:        'אי-התאמת הבטחה',
    condition:   m => (m.ctr > 0.015) && (m.conversion_rate < 0.01),
    confidence:  0.83,
    explanation: 'מודעה מבטיחה X, דף מציג Y. המשתמש לוחץ ונוטש.',
    solution:    'התאם את כותרת דף הנחיתה למסר המדויק של המודעה.',
    timeframe:   'ניתן לתקן תוך שעות',
  },
  {
    id:          'traffic_no_intent',
    name:        'תנועה ללא כוונה',
    condition:   m => (m.clicks > 100) && (m.conversion_rate < 0.005) && (m.ctr > 0.01),
    confidence:  0.78,
    explanation: 'יש קליקים אבל אין המרות — הטרגטינג רחב מדי, מושכים סקרנות לא כוונת רכישה.',
    solution:    'הצר את הקהל: הוסף Interest targeting מדויק, הסר קהלים רחבים.',
    timeframe:   'בדוק אחרי 3-5 ימי קמפיין',
  },
  {
    id:          'budget_ceiling',
    name:        'תקרת תקציב',
    condition:   m => (m.impressions > 0) && (m.cost > 0) && ((m.cost / m.impressions) * 1000 > 8),
    confidence:  0.75,
    explanation: 'CPM גבוה מ-$8 — קהל רווי, פחות מלאי. תחרות גבוהה.',
    solution:    'נסה לוקאציות נוספות, קהלי Lookalike, שעות הצגה שונות.',
    timeframe:   'בדוק ביחס לתעשייה ועונה',
  },
  {
    id:          'conversion_window',
    name:        'לידים ללא סגירה',
    condition:   m => (m.conversions > 10) && (m.revenue === 0),
    confidence:  0.70,
    explanation: 'הרבה לידים אבל אפס הכנסה — בעיה בתהליך המכירה, לא בפרסום.',
    solution:    'בדוק follow-up מהירות (< 5 דקות), סקריפט מכירה, ואיכות לידים.',
    timeframe:   'בעיה בצוות מכירות/תהליך, לא בקמפיין',
  },
  {
    id:          'roas_cliff',
    name:        'צוק ROAS',
    condition:   m => m.roas !== null && m.roas < 1 && m.cost > 50,
    confidence:  0.92,
    explanation: 'ROAS < 1 = כל דולר שמשקיעים מחזיר פחות מדולר. הפסד ישיר.',
    solution:    'עצור קמפיינים מיד. תקן לפני שתמשיך.',
    timeframe:   'פעולה נדרשת תוך 24 שעות',
  },
];

/**
 * Match current metrics against known patterns.
 * @param {object} unified — normalized metrics
 * @returns {{ matches, top_pattern, recommendations, summary }}
 */
function matchPatterns(unified) {
  const matches = KNOWN_PATTERNS
    .filter(p => {
      try { return p.condition(unified); } catch { return false; }
    })
    .map(p => ({
      id:          p.id,
      name:        p.name,
      confidence:  p.confidence,
      explanation: p.explanation,
      solution:    p.solution,
      timeframe:   p.timeframe,
    }))
    .sort((a, b) => b.confidence - a.confidence);

  return {
    matches,
    count:       matches.length,
    top_pattern: matches[0] || null,
    recommendations: matches.map(m => m.solution),
    summary: matches.length
      ? `${matches.length} דפוסים מוכרים זוהו: "${matches[0].name}" — ${matches[0].solution}`
      : 'לא זוהו דפוסים מוכרים — מצב חדש או ביצועים תקינים',
  };
}

/**
 * Build a priority ranking of all actions across the full analysis.
 * @param {object} allData — { insights, anomalies, funnelResult, experiments, tradeoffs, businessLayer }
 * @returns {{ priority_list, top_action, narrative }}
 */
function buildPriorityRanking({ insights, anomalies, funnelResult, experiments, tradeoffs, businessLayer, patterns }) {
  const actions = [];

  // From insights
  for (const ins of (insights?.priorities || []).slice(0, 5)) {
    actions.push({ source: 'insight', action: ins.impact, why: ins.why, urgency: _urgency(ins.priority), impact: ins.confidence * 100 });
  }

  // From anomalies
  for (const a of (anomalies?.signals || []).slice(0, 3)) {
    actions.push({ source: 'anomaly', action: a.action, why: a.message, urgency: _urgency(a.priority), impact: 80 });
  }

  // From funnel
  if (funnelResult?.bottleneck?.action) {
    actions.push({ source: 'funnel', action: funnelResult.bottleneck.action, why: funnelResult.bottleneck.message, urgency: _urgency(funnelResult.bottleneck.impact), impact: 90 });
  }

  // From patterns
  for (const p of (patterns?.matches || []).slice(0, 2)) {
    actions.push({ source: 'pattern', action: p.solution, why: p.explanation, urgency: 80, impact: p.confidence * 100 });
  }

  // From business
  for (const ba of (businessLayer?.alerts || []).filter(a => a.severity === 'critical' || a.severity === 'high')) {
    actions.push({ source: 'business', action: 'בדוק רווחיות ו-LTV:CAC', why: ba.message, urgency: 90, impact: 95 });
  }

  // Score and sort: urgency*0.5 + impact*0.5
  const scored = actions.map(a => ({ ...a, score: a.urgency * 0.5 + a.impact * 0.5 }));
  scored.sort((a, b) => b.score - a.score);

  // Deduplicate by action
  const seen = new Set();
  const unique = scored.filter(a => { const k = a.action?.slice(0, 30); if (seen.has(k)) return false; seen.add(k); return true; });

  const narrative = unique.length
    ? `הפעולה הבאה הכי חשובה: ${unique[0].action} — ${unique[0].why}`
    : 'אין פעולות דחופות — הקמפיין בסדר';

  return { priority_list: unique.slice(0, 8), top_action: unique[0] || null, narrative };
}

function _urgency(priority) {
  return { critical: 95, high: 80, medium: 60, low: 40 }[priority] || 60;
}

module.exports = { matchPatterns, buildPriorityRanking, KNOWN_PATTERNS };
