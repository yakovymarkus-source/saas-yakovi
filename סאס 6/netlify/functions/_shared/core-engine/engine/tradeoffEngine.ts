import { ComputedMetrics, NormalizedMetrics, Tradeoff } from '../types/domain';

export function detectTradeoffs(computed: ComputedMetrics, normalized: NormalizedMetrics): Tradeoff[] {
  const tradeoffs: Tradeoff[] = [];

  // CTR עולה → המרה יורדת (תנועה זולה ולא איכותית)
  if (computed.ctr > 0.03 && computed.conversionRate < 0.01) {
    tradeoffs.push({
      metricA: 'CTR גבוה',
      metricB: 'המרה נמוכה',
      observation: `CTR ${(computed.ctr * 100).toFixed(2)}% — אך רק ${(computed.conversionRate * 100).toFixed(2)}% מהקליקים הופכים לליד`,
      recommendation: 'הקריאייטיב מושך קליקים לא רלוונטיים — לצמצם קהל או לשנות הוק לכוון מדויק יותר'
    });
  }

  // CPL נמוך → איכות ליד נמוכה (מחיר זול = לידים חלשים)
  if (computed.cpa !== null && computed.cpa < 10 && normalized.leads > 20 && normalized.purchases < 1) {
    tradeoffs.push({
      metricA: 'CPL נמוך',
      metricB: 'אפס רכישות',
      observation: `עלות ליד ${computed.cpa.toFixed(2)} נמוכה מאוד — אך ללא המרה לרכישה`,
      recommendation: 'לידים זולים לרוב מסמנים כוונה נמוכה — לבחון איכות ליד ולא רק כמות'
    });
  }

  // ROAS גבוה → תקציב נמוך (לא מנצלים את ההחזר)
  if (computed.roas !== null && computed.roas > 5 && normalized.spend < 200) {
    tradeoffs.push({
      metricA: 'ROAS גבוה',
      metricB: 'תקציב נמוך',
      observation: `ROAS ${computed.roas.toFixed(1)}x — אך ההוצאה ${normalized.spend.toFixed(0)} נמוכה מדי למינוף`,
      recommendation: 'להעלות תקציב — ה-ROI מצדיק סקייל אבל צריך לעשות זאת בשלבים (×1.5 שבועי)'
    });
  }

  // תדירות גבוהה → CTR יורד (שחיקת קהל)
  if (normalized.frequency > 4 && computed.ctr < 0.01) {
    tradeoffs.push({
      metricA: 'תדירות גבוהה',
      metricB: 'CTR נמוך',
      observation: `תדירות ${normalized.frequency.toFixed(1)} — הקהל ראה את המודעה יותר מדי פעמים`,
      recommendation: 'להחליף קריאייטיב ולהרחיב קהל — הנוכחי שחוק'
    });
  }

  // bounce rate גבוה → עלות גבוהה לתוצאה
  if (normalized.bounceRate > 0.75 && computed.cpc < 1) {
    tradeoffs.push({
      metricA: 'CPC נמוך',
      metricB: 'Bounce rate גבוה',
      observation: `CPC ${computed.cpc.toFixed(2)} — אבל ${(normalized.bounceRate * 100).toFixed(0)}% עוזבים מיד`,
      recommendation: 'מחיר קליק נמוך לא שווה כלום אם הדף לא ממיר — לטפל בדף נחיתה לפני סקייל'
    });
  }

  return tradeoffs;
}
