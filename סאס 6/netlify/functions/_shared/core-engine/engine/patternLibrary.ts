import { ComputedMetrics, KnownPattern, NormalizedMetrics, PatternMatch } from '../types/domain';

const PATTERNS: KnownPattern[] = [
  {
    id: 'high_freq_low_ctr',
    name: 'שחיקת קהל קלאסית',
    diagnosis: 'תדירות גבוהה + CTR נמוך = הקהל ראה את המודעה יותר מדי והפסיק להגיב',
    solution: 'להחליף קריאייטיב ולהרחיב קהל עם Lookalike',
    confidence: 0.88
  },
  {
    id: 'good_ctr_bad_conversion',
    name: 'דיסקונקט מודעה-דף',
    diagnosis: 'CTR טוב אבל המרה חלשה = ההבטחה במודעה לא מתממשת בדף הנחיתה',
    solution: 'ליישר את המסר בין המודעה לדף — אותה שפה, אותה הצעה',
    confidence: 0.91
  },
  {
    id: 'zero_conversions_high_spend',
    name: 'שריפת תקציב',
    diagnosis: 'הוצאה גבוהה + אפס המרות = בעיה קריטית בדף או בקהל',
    solution: 'לעצור מיד, לבדוק פיקסל ומעקב המרות לפני כל שינוי אחר',
    confidence: 0.95
  },
  {
    id: 'low_cpa_no_purchases',
    name: 'לידים לא איכותיים',
    diagnosis: 'CPL נמוך מאוד + אין רכישות = לידים זולים אך ללא כוונת רכישה',
    solution: 'לשנות קהל לכוון רכישה, להוסיף שאלת כשירות בטופס',
    confidence: 0.82
  },
  {
    id: 'high_bounce_low_session',
    name: 'כישלון פתיחת דף',
    diagnosis: 'Bounce rate גבוה + זמן שהייה נמוך = הדף לא מתחבר לציפייה מהמודעה',
    solution: 'לשנות את הכותרת הראשית בדף כך שתמשיך ישירות את הוק המודעה',
    confidence: 0.87
  },
  {
    id: 'good_roas_low_scale',
    name: 'ROAS טוב ללא סקייל',
    diagnosis: 'ROAS גבוה + תקציב נמוך = מפסידים כסף בגלל חשש מסקייל',
    solution: 'להעלות תקציב ב-50% שבועי עד שהמערכת מייצבת מחדש',
    confidence: 0.79
  },
  {
    id: 'checkout_dropoff',
    name: 'נטישת תשלום',
    diagnosis: 'יש יוזמות תשלום אבל מעט רכישות = בעיה בדף הסל/תשלום',
    solution: 'לפשט תהליך תשלום, להוסיף ביטחון (אחריות, ביקורות), לבדוק טכנית',
    confidence: 0.85
  }
];

export function matchPatterns(computed: ComputedMetrics, normalized: NormalizedMetrics): PatternMatch[] {
  const matches: PatternMatch[] = [];

  for (const pattern of PATTERNS) {
    let score = 0;

    switch (pattern.id) {
      case 'high_freq_low_ctr':
        if (normalized.frequency > 4 && computed.ctr < 0.01) score = 0.9;
        else if (normalized.frequency > 3 && computed.ctr < 0.015) score = 0.6;
        break;

      case 'good_ctr_bad_conversion':
        if (computed.ctr > 0.02 && computed.conversionRate < 0.01) score = 0.88;
        else if (computed.ctr > 0.015 && computed.conversionRate < 0.02) score = 0.55;
        break;

      case 'zero_conversions_high_spend':
        if (normalized.leads === 0 && normalized.purchases === 0 && normalized.spend > 100) score = 0.95;
        break;

      case 'low_cpa_no_purchases':
        if (computed.cpa !== null && computed.cpa < 15 && normalized.purchases === 0 && normalized.leads > 10) score = 0.82;
        break;

      case 'high_bounce_low_session':
        if (normalized.bounceRate > 0.7 && computed.sessionDropoffRate > 0.7) score = 0.87;
        else if (normalized.bounceRate > 0.6) score = 0.5;
        break;

      case 'good_roas_low_scale':
        if (computed.roas !== null && computed.roas > 4 && normalized.spend < 300) score = 0.79;
        break;

      case 'checkout_dropoff':
        if (normalized.initiatedCheckout > 5 && computed.checkoutDropoffRate > 0.7) score = 0.85;
        break;
    }

    if (score > 0.4) {
      matches.push({ pattern, matchScore: Number(score.toFixed(2)) });
    }
  }

  return matches.sort((a, b) => b.matchScore - a.matchScore);
}
