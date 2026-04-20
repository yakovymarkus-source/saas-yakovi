import { CampaignSession, NextAction } from './types';
import { hasEnoughData, hasAnalysisData, getShortTerm } from './systemMemory';
import { hasPendingApproval } from './approvalGate';
import { countAgentCalls } from './activityLog';

const MAX_FAILURES = 3;
const MAX_RESEARCH_RETRIES = 2;
const MAX_STRATEGY_RETRIES = 2;
const MAX_EXECUTION_RETRIES = 3;

export function decideNextAction(session: CampaignSession): NextAction {

  // 1. גבולות — עצור אם יש יותר מדי כשלים
  if (session.failureCount >= MAX_FAILURES) {
    return {
      type: 'stop',
      reason: `${session.failureCount} כשלים רצופים — מחכה להתערבות אנושית`,
      confidence: 0.99,
      priority: 'critical'
    };
  }

  // 2. אם יש אישור ממתין — לא לעשות כלום עד שמקבלים תשובה
  if (hasPendingApproval(session) || session.state === 'awaiting_approval') {
    return {
      type: 'wait',
      reason: 'ממתין לאישור משתמש לפני המשך',
      confidence: 1,
      priority: 'high'
    };
  }

  const analysisResult = getShortTerm(session, 'lastAnalysisResult') as Record<string, unknown> | undefined;
  const verdict = analysisResult?.verdict as string | undefined;
  const confidence = (analysisResult?.confidence as number | undefined) ?? 0;

  switch (session.state) {

    case 'idle':
      return {
        type: 'run_agent',
        agent: 'research',
        reason: 'מתחיל מחקר שוק וקהל — זה הצעד הראשון לכל קמפיין',
        confidence: 0.95,
        priority: 'high'
      };

    case 'researching': {
      const researchDone = Boolean(getShortTerm(session, 'marketResearch'));
      if (!researchDone) {
        const retries = countAgentCalls(session, 'research');
        if (retries >= MAX_RESEARCH_RETRIES) {
          return { type: 'request_approval', reason: 'מחקר נכשל מספר פעמים — נדרש קלט ידני', confidence: 0.85, priority: 'high',
            approvalCard: { agent: 'research', problem: 'סוכן המחקר לא הצליח לייצר תוצאות', solution: 'המשתמש יספק פרטי שוק ידנית', why: 'מניעת לולאה אינסופית', expectedImpact: 'מאפשר המשך תהליך', riskLevel: 'medium' }
          };
        }
        return { type: 'run_agent', agent: 'research', reason: 'ממשיך מחקר', confidence: 0.8, priority: 'high' };
      }
      return { type: 'run_agent', agent: 'strategy', reason: 'מחקר הושלם — עובר לאסטרטגיה', confidence: 0.9, priority: 'high' };
    }

    case 'strategizing': {
      const strategyDone = Boolean(getShortTerm(session, 'strategy'));
      if (!strategyDone) {
        const retries = countAgentCalls(session, 'strategy');
        if (retries >= MAX_STRATEGY_RETRIES) {
          return { type: 'request_approval', reason: 'אסטרטגיה נכשלה מספר פעמים', confidence: 0.85, priority: 'high',
            approvalCard: { agent: 'strategy', problem: 'סוכן האסטרטגיה לא ייצר תוצאה עם ביטחון מספיק', solution: 'סקירת ידנית של זווית הפרסום', why: 'ביטחון נמוך = קמפיין חלש', expectedImpact: 'אסטרטגיה ברורה לפני ביצוע', riskLevel: 'medium' }
          };
        }
        return { type: 'run_agent', agent: 'strategy', reason: 'ממשיך בניית אסטרטגיה', confidence: 0.8, priority: 'high' };
      }
      return { type: 'run_agent', agent: 'execution', reason: 'אסטרטגיה מוכנה — עובר לבניית תוצרים', confidence: 0.9, priority: 'high' };
    }

    case 'executing': {
      const assetsDone = Boolean(getShortTerm(session, 'assets'));
      if (!assetsDone) {
        const retries = countAgentCalls(session, 'execution');
        if (retries >= MAX_EXECUTION_RETRIES) {
          return { type: 'request_approval', reason: 'בניית תוצרים נכשלה מספר פעמים', confidence: 0.9, priority: 'critical',
            approvalCard: { agent: 'execution', problem: 'לא ניתן לייצר תוצרים שעוברים QA', solution: 'בדיקת קלט עסקי וזווית הפרסום מחדש', why: 'בעיה בבסיס האסטרטגיה', expectedImpact: 'תוצרים ברמה הנדרשת', riskLevel: 'high' }
          };
        }
        return { type: 'run_agent', agent: 'execution', reason: 'ממשיך בניית תוצרים', confidence: 0.75, priority: 'high' };
      }
      return { type: 'run_agent', agent: 'qa', reason: 'תוצרים נוצרו — שולח ל-QA', confidence: 0.9, priority: 'high' };
    }

    case 'qa_review': {
      const qaResult = getShortTerm(session, 'qaResult') as Record<string, unknown> | undefined;
      const passed = Boolean(qaResult?.passed);
      if (!passed) {
        const qaFailed = (qaResult?.reasons as string[] | undefined) ?? [];
        return {
          type: 'request_approval',
          reason: 'QA נכשל — מחכה לאישור לפני חזרה לביצוע',
          confidence: 0.88,
          priority: 'high',
          approvalCard: {
            agent: 'qa',
            problem: `QA נכשל: ${qaFailed.slice(0, 2).join(', ')}`,
            solution: 'לחזור לסוכן הביצוע עם פידבק QA ולשפר',
            why: 'תוצר שלא עובר QA לא ראוי לפרסום',
            expectedImpact: 'תוצרים בסטנדרט גבוה יותר',
            riskLevel: 'medium'
          }
        };
      }
      return {
        type: 'request_approval',
        reason: 'QA עבר — לאשר מעבר ל-live?',
        confidence: 0.92,
        priority: 'high',
        approvalCard: {
          agent: 'qa',
          problem: 'הקמפיין מוכן לפרסום',
          solution: 'העלאה לאוויר',
          why: 'כל הבדיקות עברו',
          expectedImpact: 'קמפיין חי עם מדדי איכות גבוהים',
          riskLevel: 'medium'
        }
      };
    }

    case 'live':
      return { type: 'run_agent', agent: 'analysis', reason: 'קמפיין חי — עובר לניטור', confidence: 0.9, priority: 'medium' };

    case 'monitoring': {
      if (!hasAnalysisData(session)) {
        return { type: 'wait', reason: 'ממתין לדאטה מספיק לניתוח (מינימום 24 שעות)', confidence: 0.85, priority: 'low' };
      }
      return { type: 'run_agent', agent: 'analysis', reason: 'יש דאטה — מפעיל ניתוח מלא', confidence: 0.9, priority: 'high' };
    }

    case 'analyzing': {
      if (!verdict) {
        return { type: 'wait', reason: 'ניתוח בתהליך', confidence: 0.8, priority: 'medium' };
      }

      // ביטחון נמוך → לבקש אישור לפני שינוי
      if (confidence < 0.6) {
        return {
          type: 'request_approval',
          reason: 'ביטחון ניתוח נמוך — מחכה לאישור לפני פעולה',
          confidence: 0.7,
          priority: 'medium',
          approvalCard: {
            agent: 'analysis',
            problem: `ביטחון ניתוח נמוך (${(confidence * 100).toFixed(0)}%) — לא מספיק דאטה`,
            solution: 'להמשיך לאסוף נתונים עוד 3-5 ימים',
            why: 'פעולה בביטחון נמוך עלולה לפגוע בביצועים',
            expectedImpact: 'החלטות מדויקות יותר',
            riskLevel: 'low'
          }
        };
      }

      // בעיות מרכזיות → שינויים שונים
      if (verdict === 'Landing page issue') {
        return {
          type: 'request_approval',
          reason: 'ניתוח זיהה בעיית דף נחיתה — מחכה לאישור לשיפור',
          confidence,
          priority: 'critical',
          approvalCard: {
            agent: 'analysis',
            problem: 'דף הנחיתה שורף תנועה — bounce rate גבוה',
            solution: 'לשחזר דף נחיתה עם מסר מיושר למודעה',
            why: 'כל שקל שנכנס עכשיו נשפך לפני פעולה',
            expectedImpact: 'ירידה ב-bounce, עלייה בהמרות',
            riskLevel: 'high'
          }
        };
      }

      if (verdict === 'Creative failure') {
        return {
          type: 'request_approval',
          reason: 'קריאייטיב כושל — מחכה לאישור להחלפה',
          confidence,
          priority: 'high',
          approvalCard: {
            agent: 'analysis',
            problem: 'CTR נמוך — המודעה לא עוצרת גלילה',
            solution: 'שחזור מודעות עם הוקים חדשים',
            why: 'קריאייטיב הוא השלב הראשון בכל המשפך',
            expectedImpact: 'עלייה ב-CTR וירידה ב-CPC',
            riskLevel: 'medium'
          }
        };
      }

      if (verdict === 'Audience mismatch') {
        return {
          type: 'request_approval',
          reason: 'אי-התאמת קהל — מחכה לאישור לשינוי',
          confidence,
          priority: 'high',
          approvalCard: {
            agent: 'analysis',
            problem: 'הקהל הנוכחי לא מגיב — תדירות גבוהה וCTR נמוך',
            solution: 'חזרה לסוכן המחקר לבניית קהל חדש',
            why: 'שחיקת קהל הורגת קמפיינים טובים',
            expectedImpact: 'תנועה איכותית יותר',
            riskLevel: 'high'
          }
        };
      }

      if (verdict === 'Budget inefficiency') {
        return {
          type: 'request_approval',
          reason: 'תקציב לא יעיל — מחכה לאישור לאופטימיזציה',
          confidence,
          priority: 'medium',
          approvalCard: {
            agent: 'analysis',
            problem: 'ROAS נמוך — הוצאה לא מכוסה בתוצאות',
            solution: 'צמצום תקציב לסגמנטים יעילים בלבד',
            why: 'להפסיק בזבוז לפני שמוצאים את הפתרון',
            expectedImpact: 'ירידה ב-CPA',
            riskLevel: 'medium'
          }
        };
      }

      // הכל תקין → המלצה פרואקטיבית לסקייל
      return {
        type: 'proactive_suggestion',
        reason: `ניתוח חיובי עם ביטחון ${(confidence * 100).toFixed(0)}% — קמפיין עובד`,
        confidence,
        priority: 'low'
      };
    }

    case 'improving': {
      if (!hasEnoughData(session)) {
        return { type: 'run_agent', agent: 'research', reason: 'אין מספיק מידע — חוזר למחקר', confidence: 0.8, priority: 'high' };
      }
      const improvementTarget = getShortTerm(session, 'improvementTarget') as string | undefined;
      if (improvementTarget === 'landing') {
        return { type: 'run_agent', agent: 'execution', reason: 'שיפור דף נחיתה', confidence: 0.85, priority: 'high' };
      }
      if (improvementTarget === 'ads') {
        return { type: 'run_agent', agent: 'execution', reason: 'שיפור מודעות', confidence: 0.85, priority: 'high' };
      }
      if (improvementTarget === 'strategy') {
        return { type: 'run_agent', agent: 'strategy', reason: 'שינוי אסטרטגיה', confidence: 0.8, priority: 'high' };
      }
      if (improvementTarget === 'audience') {
        return { type: 'run_agent', agent: 'research', reason: 'בניית קהל חדש', confidence: 0.8, priority: 'high' };
      }
      return { type: 'start_loop', loopType: 'deep', reason: 'הפעלת לולאת שיפור עמוקה', confidence: 0.75, priority: 'medium' };
    }

    case 'paused':
      return { type: 'wait', reason: 'המערכת בהפסקה — מחכה להוראה', confidence: 1, priority: 'low' };

    case 'failed':
      return { type: 'stop', reason: 'המערכת נכשלה — נדרשת התערבות ידנית', confidence: 1, priority: 'critical' };

    default:
      return { type: 'wait', reason: 'מצב לא מוכר', confidence: 0.5, priority: 'low' };
  }
}
