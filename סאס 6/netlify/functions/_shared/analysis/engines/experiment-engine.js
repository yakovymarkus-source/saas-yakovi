'use strict';
/**
 * analysis/engines/experiment-engine.js
 * Manages experiment lifecycle: hypothesis → variants → metric → result.
 * Generates new experiment suggestions based on identified weaknesses.
 */

/**
 * Generate experiment suggestions based on analysis findings.
 * @param {object} anomalies     — from anomaly-detector
 * @param {object} funnelResult  — from funnel-analyzer
 * @param {object} trendResult   — from trend-analyzer
 * @param {object} kpiHierarchy  — from kpi-engine
 * @returns {{ suggested, activeExperiments, summary }}
 */
function generateExperiments({ anomalies, funnelResult, trendResult, kpiHierarchy }) {
  const suggested = [];

  // From funnel bottleneck
  if (funnelResult?.bottleneck?.stage) {
    const exp = _experimentFromBottleneck(funnelResult.bottleneck);
    if (exp) suggested.push(exp);
  }

  // From anomalies
  for (const anomaly of (anomalies?.signals || []).slice(0, 2)) {
    const exp = _experimentFromAnomaly(anomaly);
    if (exp) suggested.push(exp);
  }

  // From creative performance
  if (trendResult?.creative_insights?.available) {
    suggested.push(_hookExperiment(trendResult.creative_insights));
  }

  // From KPI gap
  const kpiVerdict = kpiHierarchy?.goal_verdict;
  if (kpiVerdict === 'off_track' || kpiVerdict === 'at_risk') {
    const exp = _experimentFromKpiGap(kpiHierarchy);
    if (exp) suggested.push(exp);
  }

  // Remove duplicates by type
  const unique = _dedup(suggested);

  return {
    suggested:    unique,
    count:        unique.length,
    priority_exp: unique[0] || null,
    summary:      unique.length ? `${unique.length} ניסויים מומלצים — ${unique[0]?.hypothesis}` : 'אין ניסויים מומלצים כרגע',
  };
}

// ── Experiment builders ────────────────────────────────────────────────────────

function _experimentFromBottleneck(bottleneck) {
  const templates = {
    impression_to_click: {
      type:       'creative',
      hypothesis: 'שינוי הוק/כותרת יעלה CTR ב-20%',
      variable:   'כותרת מודעה',
      variants:   ['הוק רגשי', 'הוק שאלה', 'הוק מספרי'],
      metric:     'ctr',
      winner_signal: 'CTR גבוה יותר ב-20% בביטחון 95%',
      priority:   'high',
      duration:   '7 ימים',
      budget:     '$50-100',
    },
    landing_to_lead: {
      type:       'landing_page',
      hypothesis: 'שינוי CTA וטקסט הצעה יעלה המרה ב-30%',
      variable:   'CTA וכותרת ראשית',
      variants:   ['CTA ישיר', 'CTA בנוי ערך', 'הצעה ממוקדת כאב'],
      metric:     'conversion_rate',
      winner_signal: 'המרה גבוהה יותר ב-30%',
      priority:   'critical',
      duration:   '14 ימים',
      budget:     '$200+',
    },
    click_to_landing: {
      type:       'tracking',
      hypothesis: 'תיקון tracking יגלה תנועה אמיתית לדף',
      variable:   'פיקסל / UTM parameters',
      variants:   ['פיקסל מתוקן', 'UTMs מדויקים'],
      metric:     'landing_rate',
      winner_signal: 'תנועה לדף מתקרבת ל-90% מהקליקים',
      priority:   'high',
      duration:   '3 ימים',
      budget:     '$0',
    },
  };

  const tmpl = templates[bottleneck.stage];
  if (!tmpl) return null;

  return { id: `exp_${bottleneck.stage}_${Date.now()}`, source: 'funnel_bottleneck', ...tmpl };
}

function _experimentFromAnomaly(anomaly) {
  if (anomaly.code === 'ctr_critically_low') {
    return {
      id:         `exp_ctr_fix_${Date.now()}`,
      source:     'anomaly',
      type:       'creative',
      hypothesis: 'קריאייטיב חדש לחלוטין יחלץ מ-CTR קריטי',
      variable:   'כל אלמנטי המודעה',
      variants:   ['קריאייטיב A — שאלה', 'קריאייטיב B — כאב ישיר', 'קריאייטיב C — הוכחה חברתית'],
      metric:     'ctr',
      winner_signal: 'CTR מעל 1%',
      priority:   'critical',
      duration:   '5 ימים',
      budget:     '$100',
    };
  }
  if (anomaly.code === 'clicks_without_conversions') {
    return {
      id:         `exp_conv_fix_${Date.now()}`,
      source:     'anomaly',
      type:       'landing_page',
      hypothesis: 'שינוי דף הנחיתה יתחיל לייצר המרות',
      variable:   'הצעת ערך ראשית + CTA',
      variants:   ['גרסה A — הצעה קצרה', 'גרסה B — הצעה עם הוכחות', 'גרסה C — ללא טופס ארוך'],
      metric:     'conversion_rate',
      winner_signal: 'לפחות 1 המרה מכל 50 קליקים',
      priority:   'critical',
      duration:   '7 ימים',
      budget:     '$100',
    };
  }
  return null;
}

function _hookExperiment(creativeInsights) {
  const winner = creativeInsights.winners?.[0];
  return {
    id:         `exp_hook_scale_${Date.now()}`,
    source:     'creative_performance',
    type:       'creative_scale',
    hypothesis: winner ? `שכפול סגנון "${winner.hook}" לכל הקמפיינים יעלה CTR הממוצע` : 'בדיקת סגנונות הוק שונים',
    variable:   'סגנון הוק',
    variants:   creativeInsights.winners?.map(w => w.hook).filter(Boolean) || ['הוק A', 'הוק B'],
    metric:     'ctr',
    winner_signal: 'CTR גבוה ב-15% מהממוצע הנוכחי',
    priority:   'medium',
    duration:   '10 ימים',
    budget:     '$150',
  };
}

function _experimentFromKpiGap(kpiHierarchy) {
  const primary = kpiHierarchy?.primary;
  if (!primary) return null;
  return {
    id:         `exp_kpi_${primary.key}_${Date.now()}`,
    source:     'kpi_gap',
    type:       'optimization',
    hypothesis: `שיפור ${primary.label} יחזיר את הקמפיין ליעד`,
    variable:   primary.key,
    variants:   ['אסטרטגיה A', 'אסטרטגיה B'],
    metric:     primary.key,
    winner_signal: `${primary.label} חוזר לרמת יעד`,
    priority:   'high',
    duration:   '14 ימים',
    budget:     '$200',
  };
}

/**
 * Evaluate an existing experiment result.
 * @param {object} experiment — experiment definition
 * @param {object} control    — control group metrics
 * @param {object} variant    — variant group metrics
 * @returns {object}          — result with winner, lift, confidence
 */
function evaluateExperiment(experiment, control, variant) {
  const metric   = experiment.metric;
  const ctrlVal  = control[metric]  || 0;
  const varVal   = variant[metric]  || 0;
  const lift     = ctrlVal > 0 ? ((varVal - ctrlVal) / ctrlVal) * 100 : 0;
  const improved = _isPositiveMetric(metric) ? varVal > ctrlVal : varVal < ctrlVal;

  // Simplified statistical significance (requires sample sizes)
  const ctrlN = control.clicks || control.impressions || 100;
  const varN  = variant.clicks || variant.impressions || 100;
  const pValue = _estimatePValue(ctrlVal, varVal, ctrlN, varN);
  const significant = pValue < 0.05;

  return {
    experiment_id: experiment.id,
    metric,
    control:    { value: _round(ctrlVal, 4), n: ctrlN },
    variant:    { value: _round(varVal, 4),  n: varN },
    lift:       _round(lift, 1),
    improved,
    significant,
    confidence: _round((1 - pValue) * 100, 1),
    winner:     significant && improved ? 'variant' : significant ? 'control' : 'no_winner',
    verdict:    significant && improved ? `הגרסה החדשה מנצחת ב-${_round(lift, 1)}%` : 'אין מנצח ברור — דרוש יותר דאטה',
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function _estimatePValue(p1, p2, n1, n2) {
  if (!p1 || !p2 || n1 < 10 || n2 < 10) return 0.5;
  const pooled = (p1 * n1 + p2 * n2) / (n1 + n2);
  const se     = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
  if (se === 0) return 0.5;
  const z = Math.abs(p1 - p2) / se;
  // Approximate p-value from z-score
  if (z >= 2.576) return 0.01;
  if (z >= 1.960) return 0.05;
  if (z >= 1.645) return 0.10;
  return 0.30;
}

function _isPositiveMetric(key) {
  return ['ctr', 'conversion_rate', 'conversions', 'revenue', 'roas', 'engagement'].includes(key);
}

function _dedup(experiments) {
  const seen = new Set();
  return experiments.filter(e => {
    if (seen.has(e.type)) return false;
    seen.add(e.type);
    return true;
  });
}

function _round(v, d) { return Math.round(v * Math.pow(10, d)) / Math.pow(10, d); }

module.exports = { generateExperiments, evaluateExperiment };
