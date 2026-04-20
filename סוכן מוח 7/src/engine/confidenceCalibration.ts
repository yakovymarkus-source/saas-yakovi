import { ConfidenceRecommendation, ConfidenceRoute, Issue } from '../types/domain';

function classifyConfidence(confidence: number): ConfidenceRecommendation {
  if (confidence >= 0.8) return 'act_now';
  if (confidence >= 0.6) return 'test_first';
  return 'gather_more_data';
}

const rationales: Record<ConfidenceRecommendation, string> = {
  act_now: 'הדאטה ברור — הבעיה מזוהה עם ביטחון גבוה. לפעול מיד.',
  test_first: 'ישנה אינדיקציה לבעיה אך לא מספיק דאטה לאיבחון סופי — להריץ A/B קטן תחילה.',
  gather_more_data: 'הדאטה לא מספיק לאיבחון בטוח — להמשיך לאסוף נתונים לפחות 3-5 ימים לפני שינוי'
};

export function calibrateConfidence(confidence: number, issues: Issue[]): ConfidenceRoute {
  const recommendation = classifyConfidence(confidence);
  const topIssue = issues[0];
  const baseRationale = rationales[recommendation];

  const rationale = topIssue
    ? `${baseRationale} (בעיה מרכזית: ${topIssue.code} עם ביטחון ${(topIssue.confidence * 100).toFixed(0)}%)`
    : baseRationale;

  return {
    confidence: Number(confidence.toFixed(2)),
    recommendation,
    rationale
  };
}
