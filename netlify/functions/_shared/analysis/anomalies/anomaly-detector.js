'use strict';
/**
 * analysis/anomalies/anomaly-detector.js
 * Detects statistically significant anomalies: sharp drops, spikes,
 * traffic/conversion disconnects, and suspicious patterns.
 */

const ANOMALY_THRESHOLDS = {
  sharp_drop_pct:     -30,   // % drop that qualifies as sharp
  sharp_spike_pct:     80,   // % spike that qualifies as significant
  click_conv_ratio:    0.50, // if clicks grew >50% but conversions didn't grow
  ctr_floor:           0.003, // CTR below this is anomalous
  cpa_spike_factor:    2.5,  // CPA more than 2.5x the previous is anomalous
  frequency_ceiling:   5.0,  // frequency above this signals exhaustion
};

/**
 * Detect anomalies across current metrics snapshot.
 * @param {object} current  — unified metrics
 * @param {object} previous — previous period metrics (optional)
 * @param {object[]} history — array of past periods for trend context
 * @returns {{ anomalies, signals, severity, summary }}
 */
function detectAnomalies(current, previous = null, history = []) {
  const anomalies = [];

  // ── Point anomalies (current snapshot only) ──────────────────────────────────
  _detectPointAnomalies(current, anomalies);

  // ── Delta anomalies (requires previous period) ─────────────────────────────
  if (previous) {
    _detectDeltaAnomalies(current, previous, anomalies);
  }

  // ── Structural anomalies (relationship between metrics) ───────────────────
  _detectStructuralAnomalies(current, anomalies);

  // ── Trend anomalies (requires history) ────────────────────────────────────
  if (history.length >= 3) {
    _detectTrendAnomalies(current, history, anomalies);
  }

  const severity = _calcSeverity(anomalies);
  const signals  = anomalies.filter(a => a.priority === 'critical' || a.priority === 'high');

  return {
    anomalies,
    signals,
    count:    anomalies.length,
    severity,
    summary:  _buildSummary(anomalies, severity),
    has_anomalies: anomalies.length > 0,
  };
}

// ── Point anomalies ────────────────────────────────────────────────────────────

function _detectPointAnomalies(m, out) {
  if (m.ctr > 0 && m.ctr < ANOMALY_THRESHOLDS.ctr_floor) {
    out.push(_anomaly({
      code:     'ctr_critically_low',
      type:     'performance',
      priority: 'critical',
      metric:   'ctr',
      value:    m.ctr,
      message:  `CTR קריטי (${_pct(m.ctr)}) — המודעות לא רלוונטיות לקהל`,
      action:   'החלף קריאייטיב מיד — הפסקה גורמת להפסד תקציב',
    }));
  }

  if (m.frequency && m.frequency >= ANOMALY_THRESHOLDS.frequency_ceiling) {
    out.push(_anomaly({
      code:     'audience_exhaustion',
      type:     'fatigue',
      priority: 'high',
      metric:   'frequency',
      value:    m.frequency,
      message:  `תדירות גבוהה מדי (${m.frequency.toFixed(1)}x) — קהל שחוק`,
      action:   'הרחב קהל, הוסף exclusion lists, רענן קריאייטיב',
    }));
  }

  if (m.clicks > 0 && m.conversions === 0 && m.clicks >= 50) {
    out.push(_anomaly({
      code:     'clicks_without_conversions',
      type:     'funnel',
      priority: 'critical',
      metric:   'conversions',
      value:    0,
      message:  `${m.clicks} קליקים ואפס המרות — בעיית דף נחיתה או פיקסל`,
      action:   'בדוק פיקסל, בדוק מהירות דף, בדוק התאמת מסר',
    }));
  }

  if (m.roas !== null && m.roas > 0 && m.roas < 0.5) {
    out.push(_anomaly({
      code:     'roas_critically_low',
      type:     'economics',
      priority: 'critical',
      metric:   'roas',
      value:    m.roas,
      message:  `ROAS קריטי (${m.roas.toFixed(2)}x) — מוציאים פי 2 ממה שמכניסים`,
      action:   'הפסק קמפיינים לא יעילים מיד, בדוק הגדרת המרות',
    }));
  }
}

// ── Delta anomalies ────────────────────────────────────────────────────────────

function _detectDeltaAnomalies(curr, prev, out) {
  const metrics = ['impressions', 'clicks', 'conversions', 'ctr', 'roas', 'cpa'];

  for (const key of metrics) {
    const c = curr[key];
    const p = prev[key];
    if (!p || !c || p === 0) continue;

    const pct = ((c - p) / Math.abs(p)) * 100;

    if (pct <= ANOMALY_THRESHOLDS.sharp_drop_pct) {
      out.push(_anomaly({
        code:     `sharp_drop_${key}`,
        type:     'drop',
        priority: pct <= -50 ? 'critical' : 'high',
        metric:   key,
        value:    c,
        previous: p,
        pct_change: _round(pct, 1),
        message:  `${_metricLabel(key)} ירד ב-${Math.abs(_round(pct, 0))}% — ירידה חדה`,
        action:   _dropAction(key),
      }));
    }

    if (pct >= ANOMALY_THRESHOLDS.sharp_spike_pct) {
      out.push(_anomaly({
        code:     `sharp_spike_${key}`,
        type:     'spike',
        priority: 'medium',
        metric:   key,
        value:    c,
        previous: p,
        pct_change: _round(pct, 1),
        message:  `${_metricLabel(key)} קפץ ב-${_round(pct, 0)}% — בדוק אם מדובר בשיפור אמיתי`,
        action:   'וודא שהנתונים אמיתיים ולא שגיאת tracking',
      }));
    }
  }

  // Click/Conversion disconnect
  const clickGrowth = prev.clicks > 0 ? (curr.clicks - prev.clicks) / prev.clicks : 0;
  const convGrowth  = prev.conversions > 0 ? (curr.conversions - prev.conversions) / prev.conversions : -1;
  if (clickGrowth >= ANOMALY_THRESHOLDS.click_conv_ratio && convGrowth < 0) {
    out.push(_anomaly({
      code:     'click_conversion_disconnect',
      type:     'funnel',
      priority: 'high',
      metric:   'conversion_rate',
      message:  'קליקים גדלו אך המרות ירדו — התנועה לא איכותית או הדף השתנה',
      action:   'בדוק מקורות תנועה חדשים, בדוק שינויים בדף הנחיתה',
    }));
  }
}

// ── Structural anomalies ───────────────────────────────────────────────────────

function _detectStructuralAnomalies(m, out) {
  // Revenue without tracking setup
  if (m.cost > 100 && m.revenue === 0 && m.conversions > 0) {
    out.push(_anomaly({
      code:     'missing_revenue_tracking',
      type:     'tracking',
      priority: 'medium',
      metric:   'revenue',
      message:  'יש המרות אך אין נתוני הכנסה — tracking ערך חסר',
      action:   'הוסף ערך המרה לפיקסל/tag',
    }));
  }

  // CPA without cpl target makes analysis hard
  if (m.cpa && m.cpa > 500) {
    out.push(_anomaly({
      code:     'extremely_high_cpa',
      type:     'economics',
      priority: 'high',
      metric:   'cpa',
      value:    m.cpa,
      message:  `CPA גבוה מאוד ($${m.cpa}) — ייתכן שגיאת הגדרה`,
      action:   'בדוק מה נחשב כ"המרה" בהגדרות הקמפיין',
    }));
  }
}

// ── Trend anomalies ────────────────────────────────────────────────────────────

function _detectTrendAnomalies(current, history, out) {
  const ctrHistory = history.map(h => h.ctr).filter(Boolean);
  if (ctrHistory.length >= 3) {
    const avgCtr = ctrHistory.reduce((s, v) => s + v, 0) / ctrHistory.length;
    if (current.ctr < avgCtr * 0.6) {
      out.push(_anomaly({
        code:     'ctr_below_historical_avg',
        type:     'trend',
        priority: 'medium',
        metric:   'ctr',
        value:    current.ctr,
        message:  `CTR נמוך ב-${_round((1 - current.ctr / avgCtr) * 100, 0)}% מהממוצע ההיסטורי`,
        action:   'בחן אם קהל היעד השתנה או הקריאייטיב ישן',
      }));
    }

    const isConsistentDecline = ctrHistory.every((v, i) => i === 0 || v <= ctrHistory[i - 1]);
    if (isConsistentDecline && ctrHistory.length >= 3) {
      out.push(_anomaly({
        code:     'ctr_sustained_decline',
        type:     'trend',
        priority: 'high',
        metric:   'ctr',
        message:  'ירידה רצופה ב-CTR — דפוס שחיקה מערכתי',
        action:   'נדרש רענון קמפיין מקיף — קריאייטיב, קהל, ואסטרטגיה',
      }));
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function _calcSeverity(anomalies) {
  if (anomalies.some(a => a.priority === 'critical')) return 'critical';
  if (anomalies.some(a => a.priority === 'high'))     return 'high';
  if (anomalies.some(a => a.priority === 'medium'))   return 'medium';
  return 'none';
}

function _buildSummary(anomalies, severity) {
  if (!anomalies.length) return 'לא זוהו אנומליות — הנתונים נראים תקינים';
  const critical = anomalies.filter(a => a.priority === 'critical');
  if (critical.length) return `${critical.length} אנומליות קריטיות — ${critical[0].message}`;
  return `${anomalies.length} אנומליות זוהו (חומרה: ${severity})`;
}

function _anomaly(fields) {
  return { detected_at: new Date().toISOString(), ...fields };
}

function _dropAction(key) {
  const map = {
    impressions:  'בדוק סטטוס קמפיין ותקציב יומי',
    clicks:       'בדוק קריאייטיב וטרגטינג',
    conversions:  'בדוק פיקסל ודף נחיתה',
    ctr:          'החלף קריאייטיב',
    roas:         'בחן יעילות הוצאה ועצור קמפיינים לא יעילים',
    cpa:          'בדוק מה גורם לעלייה בעלות לליד',
  };
  return map[key] || 'חקור את הגורם לשינוי';
}

function _metricLabel(key) {
  const labels = { impressions: 'חשיפות', clicks: 'קליקים', conversions: 'המרות', ctr: 'CTR', roas: 'ROAS', cpa: 'CPA' };
  return labels[key] || key;
}

function _pct(v) { return `${(v * 100).toFixed(2)}%`; }
function _round(v, d) { return Math.round(v * Math.pow(10, d)) / Math.pow(10, d); }

module.exports = { detectAnomalies, ANOMALY_THRESHOLDS };
