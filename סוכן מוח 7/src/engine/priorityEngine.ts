import { Action, PriorityDirective, VerdictType } from '../types/domain';

const DEPENDENCY_RULES: Array<{
  blocker: VerdictType;
  blocked: VerdictType;
  reason: string;
}> = [
  {
    blocker: 'Landing page issue',
    blocked: 'Budget inefficiency',
    reason: 'אין טעם להגדיל תקציב כשהדף שורף אותו — לתקן דף קודם'
  },
  {
    blocker: 'Creative failure',
    blocked: 'Audience mismatch',
    reason: 'עם קריאייטיב שבור לא ניתן לאבחן בעיית קהל — לתקן קריאייטיב קודם'
  }
];

export function buildPriorityDirectives(actions: Action[], verdict: VerdictType): PriorityDirective[] {
  const directives: PriorityDirective[] = [];

  // מיין לפי priority score קיים
  const sorted = [...actions].sort((a, b) => b.priorityScore - a.priorityScore);

  sorted.forEach((action, index) => {
    const directive: PriorityDirective = {
      order: index + 1,
      action: action.title,
      reason: action.why
    };

    // בדוק חסמים
    const blockingRule = DEPENDENCY_RULES.find(rule => rule.blocker === verdict);
    if (blockingRule && index > 0) {
      const isBlocked = sorted[0].title !== action.title;
      if (isBlocked) {
        directive.blockedBy = `${sorted[0].title} (${blockingRule.reason})`;
      }
    }

    directives.push(directive);
  });

  // הוסף הנחיה גלובלית כשיש בעיית דף קריטית
  if (verdict === 'Landing page issue') {
    directives.unshift({
      order: 0,
      action: 'עצור סקייל מידי',
      reason: 'כל שקל שנכנס עכשיו נשפך — דף שבור מבטל כל שיפור אחר'
    });
  }

  return directives.map((d, i) => ({ ...d, order: i + 1 }));
}
