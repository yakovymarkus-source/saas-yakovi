'use strict';
/**
 * analysis/causality/causality-engine.js
 * WHY analysis: detects what changed between two analysis snapshots and why.
 * Returns structured causal chains with confidence levels.
 */

/**
 * Compare current vs previous metrics and generate causal explanations.
 * @param {object} current  — unified metrics (from data-normalizer)
 * @param {object} previous — previous unified metrics (may be null)
 * @param {object} context  — optional { platform, goal, decisionLayer }
 * @returns {object}
 */
function analyzeCausality(current, previous, context = {}) {
  if (!previous) {
    return { changes: [], chains: [], summary: 'ניתוח ראשוני — אין נתוני השוואה', hasComparison: false };
  }

  const changes = _detectChanges(current, previous);
  const chains  = _buildCausalChains(changes, current, previous, context);
  const summary = _buildCausalSummary(chains);

  return { changes, chains, summary, hasComparison: true };
}

// ── Change Detection ────────────────────────────────────────────────────────────

const TRACKED_METRICS = ['impressions', 'clicks', 'ctr', 'conversions', 'conversion_rate', 'cost', 'revenue', 'roas', 'cpc', 'cpa', 'engagement', 'followers'];

function _detectChanges(curr, prev) {
  const changes = [];
  for (const key of TRACKED_METRICS) {
    const cVal = curr[key];
    const pVal = prev[key];
    if (pVal === null || pVal === undefined || pVal === 0) continue;
    if (cVal === null || cVal === undefined) continue;

    const delta  = cVal - pVal;
    const pctChg = (delta / Math.abs(pVal)) * 100;
    if (Math.abs(pctChg) < 5) continue; // ignore noise < 5%

    changes.push({
      metric:     key,
      previous:   pVal,
      current:    cVal,
      delta,
      pct_change: _round(pctChg, 1),
      direction:  delta > 0 ? 'up' : 'down',
      magnitude:  Math.abs(pctChg) >= 30 ? 'sharp' : Math.abs(pctChg) >= 15 ? 'moderate' : 'small',
    });
  }
  return changes.sort((a, b) => Math.abs(b.pct_change) - Math.abs(a.pct_change));
}

// ── Causal Chain Builder ────────────────────────────────────────────────────────

function _buildCausalChains(changes, curr, prev, context) {
  const chains = [];

  // CTR dropped
  const ctrChange = changes.find(c => c.metric === 'ctr');
  if (ctrChange && ctrChange.direction === 'down' && Math.abs(ctrChange.pct_change) >= 10) {
    chains.push(_causalChain({
      change:     `CTR ירד ב-${Math.abs(ctrChange.pct_change)}%`,
      reason:     _ctrDropReason(curr, prev, context),
      confidence: _ctrDropConfidence(curr, prev, ctrChange),
      impact:     'פחות קליקים → פחות המרות → ROAS נמוך יותר',
      metric:     'ctr',
      actions:    ['רענן קריאייטיב', 'בדוק טרגטינג', 'בצע A/B לכותרות'],
    }));
  }

  // CTR improved
  if (ctrChange && ctrChange.direction === 'up' && Math.abs(ctrChange.pct_change) >= 10) {
    chains.push(_causalChain({
      change:     `CTR עלה ב-${ctrChange.pct_change}%`,
      reason:     'קריאייטיב חדש משפר ביצועים, טרגטינג מדויק יותר, או עונתיות חיובית',
      confidence: 0.70,
      impact:     'יותר קליקים בעלות דומה — הזדמנות לסקייל',
      metric:     'ctr',
      actions:    ['הגדל תקציב לפרסומות שמציגות את השיפור'],
    }));
  }

  // Conversion rate dropped
  const crChange = changes.find(c => c.metric === 'conversion_rate');
  if (crChange && crChange.direction === 'down' && Math.abs(crChange.pct_change) >= 10) {
    chains.push(_causalChain({
      change:     `שיעור המרה ירד ב-${Math.abs(crChange.pct_change)}%`,
      reason:     'דף הנחיתה לא תואם את הציפיות מהמודעה, בעיית UX, או תנועה לא מתאימה',
      confidence: 0.78,
      impact:     'אותה הוצאה → פחות לידים/רכישות → ROAS נפגע',
      metric:     'conversion_rate',
      actions:    ['בדוק התאמת מסר מפרסומת לדף', 'בצע בדיקת מהירות', 'בדוק שינויים בדף'],
    }));
  }

  // Cost jumped without revenue increase
  const costChange    = changes.find(c => c.metric === 'cost');
  const revenueChange = changes.find(c => c.metric === 'revenue');
  if (costChange && costChange.direction === 'up' && Math.abs(costChange.pct_change) >= 20) {
    const revenueGrew = revenueChange && revenueChange.pct_change >= costChange.pct_change * 0.7;
    if (!revenueGrew) {
      chains.push(_causalChain({
        change:     `עלויות עלו ב-${costChange.pct_change}% ללא שיפור פרופורציונלי בהכנסות`,
        reason:     'תחרות מוגברת במכרז, שחיקת קהל, או הגדלת תקציב לא מכוונת',
        confidence: 0.73,
        impact:     'ROAS יורד — יש לבחון יעילות ההוצאה',
        metric:     'cost',
        actions:    ['בדוק מי מציע מחיר גבוה יותר', 'צמצם תקציב לסגמנטים עם CPA גבוה'],
      }));
    }
  }

  // Impressions dropped sharply
  const impChange = changes.find(c => c.metric === 'impressions');
  if (impChange && impChange.direction === 'down' && Math.abs(impChange.pct_change) >= 25) {
    chains.push(_causalChain({
      change:     `חשיפות ירדו ב-${Math.abs(impChange.pct_change)}%`,
      reason:     'קמפיין הוגבל בתקציב, שינוי באלגוריתם פלטפורמה, או בעיית אישור מודעות',
      confidence: 0.82,
      impact:     'פחות חשיפה → פחות קליקים → פחות המרות',
      metric:     'impressions',
      actions:    ['בדוק סטטוס קמפיין בפלטפורמה', 'בדוק אם יש מודעות שנדחו', 'הגדל תקציב יומי'],
    }));
  }

  return chains;
}

function _ctrDropReason(curr, prev, context) {
  if (curr.frequency && curr.frequency > 3.5) return 'עייפות קהל — אותה מודעה נראתה יותר מדי פעמים';
  if (curr.impressions > prev.impressions * 1.3)  return 'הגדלת חשיפה לקהל חם פחות — נורמלי בסקייל';
  return 'ירידה ברלוונטיות הקריאייטיב — נדרש רענון מסר';
}

function _ctrDropConfidence(curr, prev, change) {
  if (curr.frequency > 3.5) return 0.88;
  if (Math.abs(change.pct_change) >= 30) return 0.84;
  return 0.70;
}

function _causalChain({ change, reason, confidence, impact, metric, actions }) {
  return { change, reason, confidence: _round(confidence, 2), impact, metric, recommended_actions: actions };
}

function _buildCausalSummary(chains) {
  if (!chains.length) return 'אין שינויים משמעותיים — הקמפיין יציב';
  const top = chains[0];
  return `${top.change}: ${top.reason}`;
}

function _round(v, d) { return Math.round(v * Math.pow(10, d)) / Math.pow(10, d); }

module.exports = { analyzeCausality };
