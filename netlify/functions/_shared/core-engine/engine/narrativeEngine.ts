import { EngineResult, Issue, NarrativeOutput, VerdictType } from '../types/domain';

const bottleneckDescriptions: Record<VerdictType, string> = {
  'Creative failure': 'הקריאייטיב — המודעה לא עוצרת את הגלילה',
  'Audience mismatch': 'הקהל — המסר לא מדבר לאנשים הנכונים',
  'Landing page issue': 'דף הנחיתה — אנשים נכנסים ונוטשים לפני פעולה',
  'Budget inefficiency': 'תקציב — ההוצאה לא מתורגמת לתוצאות'
};

const actionDescriptions: Record<VerdictType, string> = {
  'Creative failure': 'להחליף את הקריאייטיב — הוק חדש, מסר חדש, בדיקת A/B',
  'Audience mismatch': 'לצמצם ולהחדד את הקהל — להוציא סגמנטים חלשים',
  'Landing page issue': 'לתקן את הדף לפני כל שינוי אחר — כל שקל שנכנס כרגע נשפך',
  'Budget inefficiency': 'לעצור את הבזבוז — לנתח עלות לתוצאה ולהשאיר רק מה שעובד'
};

function buildStory(issues: Issue[], confidence: number): string {
  const top = issues[0];
  const rest = issues.slice(1, 3);

  let story = `הבעיה המרכזית היא ${top.reason.toLowerCase()}`;

  if (rest.length) {
    const secondary = rest.map(i => i.reason.toLowerCase()).join(' וגם ');
    story += ` — בנוסף קיימות בעיות משניות: ${secondary}`;
  }

  if (confidence < 0.7) {
    story += `. רמת הביטחון נמוכה (${(confidence * 100).toFixed(0)}%) — מומלץ לבדוק עם עוד דאטה לפני פעולה גדולה`;
  }

  return story;
}

export function buildNarrative(result: Pick<EngineResult, 'verdict' | 'confidence' | 'issues'>): NarrativeOutput {
  const { verdict, confidence, issues } = result;
  const top = issues[0];

  const headline = `הקמפיין נופל בגלל ${bottleneckDescriptions[verdict]}`;
  const story = buildStory(issues, confidence);
  const bottleneck = top.stage;
  const action = actionDescriptions[verdict];

  return { headline, story, bottleneck, action };
}
