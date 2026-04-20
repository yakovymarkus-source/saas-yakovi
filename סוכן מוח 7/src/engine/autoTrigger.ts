import { AutoTriggerRule, ComputedMetrics, NormalizedMetrics, TriggerSeverity } from '../types/domain';
import { engineConfig } from '../config/engineConfig';

function rule(
  id: string,
  condition: string,
  triggered: boolean,
  action: string,
  severity: TriggerSeverity
): AutoTriggerRule {
  return { id, condition, triggered, action, severity };
}

export function evaluateAutoTriggers(computed: ComputedMetrics, normalized: NormalizedMetrics): AutoTriggerRule[] {
  const triggers: AutoTriggerRule[] = [];

  // קמפיין ללא המרות מעל 5 שעות / spend גבוה
  triggers.push(rule(
    'zero_conversion_high_spend',
    `spend > ${engineConfig.thresholds.cpaHigh * 2} AND conversions = 0`,
    normalized.spend > engineConfig.thresholds.cpaHigh * 2 && normalized.leads === 0 && normalized.purchases === 0,
    'השהה קמפיין — ללא המרות עם הוצאה גבוהה',
    'critical'
  ));

  // CTR קריטי
  triggers.push(rule(
    'ctr_critical',
    `CTR < ${engineConfig.thresholds.ctrCritical}`,
    computed.ctr < engineConfig.thresholds.ctrCritical,
    'הפסק הצגת מודעה ועבור לגרסה חלופית',
    'high'
  ));

  // ROAS גבוה → טריגר להעלות תקציב
  triggers.push(rule(
    'scale_opportunity',
    `ROAS > 4 AND spend < 500`,
    computed.roas !== null && computed.roas > 4 && normalized.spend < 500,
    'הגדל תקציב ב-50% — ROAS גבוה מצדיק סקייל',
    'medium'
  ));

  // תדירות גבוהה מדי → החלף קריאייטיב
  triggers.push(rule(
    'frequency_overload',
    `frequency > 5`,
    normalized.frequency > 5,
    'עדכן קריאייטיב — קהל שחוק',
    'high'
  ));

  // bounce rate קריטי
  triggers.push(rule(
    'bounce_critical',
    `bounceRate > 0.85`,
    normalized.bounceRate > 0.85,
    'עצור תנועה לדף זה — Bounce rate קריטי',
    'critical'
  ));

  // ROAS מתחת לסף → צמצם תקציב
  triggers.push(rule(
    'roas_below_threshold',
    `ROAS < ${engineConfig.thresholds.roasLow}`,
    computed.roas !== null && computed.roas < engineConfig.thresholds.roasLow,
    'צמצם תקציב ב-30% — ROAS מתחת לסף כדאיות',
    'high'
  ));

  // הצג רק טריגרים שהופעלו
  return triggers.filter(t => t.triggered);
}
