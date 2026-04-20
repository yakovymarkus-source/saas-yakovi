import { ComputedMetrics, EngineResult, NormalizedMetrics, QueryResponse } from '../types/domain';

type QueryIntent =
  | 'why_campaign_dropped'
  | 'why_ctr_low'
  | 'why_no_conversions'
  | 'what_to_fix_first'
  | 'is_campaign_profitable'
  | 'why_high_cpc'
  | 'what_is_bottleneck'
  | 'should_scale'
  | 'unknown';

const INTENT_PATTERNS: Array<{ intent: QueryIntent; patterns: RegExp[] }> = [
  { intent: 'why_campaign_dropped', patterns: [/ירד|נפל|ירידה|why.*drop|drop/i] },
  { intent: 'why_ctr_low', patterns: [/ctr|עצירה|הקלקה|קליק|click/i] },
  { intent: 'why_no_conversions', patterns: [/המרה|conversions|ליד|leads|רכישה|purchase/i] },
  { intent: 'what_to_fix_first', patterns: [/מה לתקן|מה קודם|איפה להתחיל|what.*fix|priority/i] },
  { intent: 'is_campaign_profitable', patterns: [/רווחי|roas|כסף|כדאי|profit/i] },
  { intent: 'why_high_cpc', patterns: [/cpc|יקר|עלות קליק/i] },
  { intent: 'what_is_bottleneck', patterns: [/צוואר בקבוק|bottleneck|איפה נשבר|where.*break/i] },
  { intent: 'should_scale', patterns: [/להגדיל|סקייל|scale|תקציב|budget/i] }
];

function detectIntent(query: string): QueryIntent {
  for (const { intent, patterns } of INTENT_PATTERNS) {
    if (patterns.some(p => p.test(query))) return intent;
  }
  return 'unknown';
}

function answerIntent(intent: QueryIntent, result: EngineResult, computed: ComputedMetrics, normalized: NormalizedMetrics): { answer: string; relatedIssues: string[]; confidence: number } {
  const issues = result.issues.map(i => i.code);

  switch (intent) {
    case 'why_campaign_dropped':
      return {
        answer: `הקמפיין ירד בגלל: ${result.issues[0]?.reason ?? 'לא זוהתה סיבה ברורה'}. הבעיה הדומיננטית היא ${result.verdict}.`,
        relatedIssues: issues.slice(0, 3),
        confidence: result.confidence
      };

    case 'why_ctr_low':
      return {
        answer: computed.ctr < 0.01
          ? `CTR נמוך (${(computed.ctr * 100).toFixed(2)}%) — ככל הנראה בעיית הוק: המודעה לא עוצרת את הגלילה. לנסות הוק שונה שפותח בכאב ישיר.`
          : `CTR (${(computed.ctr * 100).toFixed(2)}%) — לא קריטי אבל יש מקום לשיפור. לבדוק תדירות: ${normalized.frequency.toFixed(1)}.`,
        relatedIssues: issues.filter(i => i.includes('ctr') || i.includes('creative')),
        confidence: 0.82
      };

    case 'why_no_conversions':
      if (normalized.leads === 0 && normalized.purchases === 0) {
        return {
          answer: `אפס המרות — לבדוק: 1) פיקסל תקין? 2) דף נחיתה נטען? 3) הצעה מספיק ברורה? לא להמשיך להוציא כסף עד שזה נפתר.`,
          relatedIssues: issues.filter(i => i.includes('landing') || i.includes('budget')),
          confidence: 0.9
        };
      }
      return {
        answer: `אחוז המרה נמוך (${(computed.conversionRate * 100).toFixed(2)}%) — הבעיה כנראה בדף נחיתה. Drop-off שלב ל-דף: ${(computed.landingPageDropoffRate * 100).toFixed(0)}%.`,
        relatedIssues: issues,
        confidence: 0.78
      };

    case 'what_to_fix_first':
      return {
        answer: result.priorityDirectives?.length
          ? `לפי הניתוח — הפעולה הראשונה היא: "${result.priorityDirectives[0].action}". ${result.priorityDirectives[0].reason}`
          : `לתקן תחילה: ${result.prioritizedActions[0]?.title ?? 'לא זוהו פעולות'}`,
        relatedIssues: issues.slice(0, 2),
        confidence: result.confidence
      };

    case 'is_campaign_profitable':
      if (computed.roas === null) {
        return { answer: 'אין מספיק דאטה לחישוב רווחיות — לוודא שמעקב המרות מחובר.', relatedIssues: [], confidence: 0.5 };
      }
      return {
        answer: computed.roas >= 2
          ? `הקמפיין רווחי — ROAS ${computed.roas.toFixed(2)}x. ${computed.roas > 4 ? 'מומלץ לשקול סקייל.' : 'יש עוד מה לשפר.'}`
          : `הקמפיין לא רווחי — ROAS ${computed.roas.toFixed(2)}x. לעצור ולנתח לפני שממשיכים.`,
        relatedIssues: issues.filter(i => i.includes('budget')),
        confidence: 0.85
      };

    case 'why_high_cpc':
      return {
        answer: `CPC גבוה (${computed.cpc.toFixed(2)}) — בדרך כלל בגלל תחרות גבוהה על הקהל, CTR נמוך, או ציון רלוונטיות נמוך. ${normalized.frequency > 3 ? 'תדירות גבוהה מגדילה גם היא עלות.' : ''}`,
        relatedIssues: issues.filter(i => i.includes('creative') || i.includes('audience')),
        confidence: 0.75
      };

    case 'what_is_bottleneck':
      return {
        answer: result.narrative
          ? `הצוואר בקבוק נמצא ב: ${result.narrative.bottleneck}. ${result.narrative.story}`
          : `הצוואר בקבוק הוא ${result.issues[0]?.stage ?? 'לא ידוע'}.`,
        relatedIssues: issues,
        confidence: result.confidence
      };

    case 'should_scale':
      if (computed.roas !== null && computed.roas > 3 && result.confidence > 0.75) {
        return { answer: `כן לסקייל — ROAS ${computed.roas.toFixed(1)}x וביטחון ניתוח גבוה. לעלות תקציב ב-50% ולמדוד שבוע.`, relatedIssues: [], confidence: 0.82 };
      }
      return { answer: 'לא מומלץ לסקייל כרגע — יש לפתור קודם את הבעיות הקיימות.', relatedIssues: issues, confidence: 0.8 };

    default:
      return {
        answer: `על בסיס הניתוח: הקמפיין מציג ${result.verdict} עם ביטחון ${(result.confidence * 100).toFixed(0)}%. הפעולה המומלצת: ${result.prioritizedActions[0]?.title ?? 'לבדוק נתונים נוספים'}.`,
        relatedIssues: issues,
        confidence: result.confidence
      };
  }
}

export function queryAnalysis(query: string, result: EngineResult, computed: ComputedMetrics, normalized: NormalizedMetrics): QueryResponse {
  const intent = detectIntent(query);
  const { answer, relatedIssues, confidence } = answerIntent(intent, result, computed, normalized);
  return { query, answer, relatedIssues, confidence };
}
