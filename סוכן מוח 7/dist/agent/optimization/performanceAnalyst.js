"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runPerformanceAnalysis = runPerformanceAnalysis;
const explainLikeHuman_1 = require("../../engine/explainLikeHuman");
function pushIssue(issues, issue) {
    issues.push(issue);
}
function addBrief(briefs, brief) {
    briefs.push(brief);
}
async function runPerformanceAnalysis(input) {
    const issues = [];
    const briefs = [];
    if ((input.ctr ?? 0) < 1) {
        const hookWeak = (input.hookRate ?? 0) < 20;
        pushIssue(issues, {
            metric: 'ctr',
            severity: 'high',
            finding: hookWeak ? 'CTR נמוך כי המודעה לא עוצרת מספיק מהר.' : 'CTR נמוך למרות עצירה ראשונית סבירה.',
            rootCause: hookWeak ? 'Hook חלש בתחילת הקריאייטיב.' : 'אי-התאמה בין הקהל לבין הזווית/הבטחה.',
            businessMeaning: hookWeak ? 'אתה קונה חשיפה שלא מתרגמת לכניסה.' : 'הקהל רואה אותך אבל לא מרגיש שאתה מדבר אליו.',
            recommendedAction: hookWeak ? 'לשכתב הוק עם כאב חד, ניגוד ברור ותוצאה קונקרטית כבר בשתי השניות הראשונות.' : 'לצמצם קהל ולחבר את הזווית ישירות לפרסונה אחת במקום לדבר רחב.',
            priority: 1,
            confidence: hookWeak ? 91 : 78,
            expectedImpact: 'high'
        });
        addBrief(briefs, {
            assetType: 'ad',
            reason: hookWeak ? 'הוק חלש' : 'אי-התאמת קהל-זווית',
            exactAction: hookWeak ? 'להחליף פתיחים בכל המודעות להוקים קצרים שמתחילים בכאב או הפסד מוחשי.' : 'לחדד את המודעות לפרסונה אחת ולמחוק ניסוחים רחבים.',
            priority: 1
        });
        addBrief(briefs, {
            assetType: 'video_script',
            reason: hookWeak ? 'פתיחה לא עוצרת גלילה' : 'מסר לא פוגע בפרסונה',
            exactAction: 'לכתוב מחדש את שורת הפתיחה כך שתכה בכאב הראשון של הקהל ותאמר מה נשבר.',
            priority: 2
        });
    }
    if ((input.cpc ?? 0) > 2.5) {
        const auctionPressure = (input.ctr ?? 0) >= 1.2;
        pushIssue(issues, {
            metric: 'cpc',
            severity: 'high',
            finding: auctionPressure ? 'CPC גבוה למרות CTR סביר.' : 'CPC גבוה יחד עם רלוונטיות חלשה.',
            rootCause: auctionPressure ? 'לחץ מכרז או קהל יקר.' : 'המודעה לא מספיק רלוונטית ולכן הפלטפורמה גובה יותר.',
            businessMeaning: auctionPressure ? 'הבעיה פחות בקריאייטיב ויותר בכלכלת המדיה.' : 'אתה משלם פרמיה על מסר שלא מרגיש מדויק.',
            recommendedAction: auctionPressure ? 'לשמור על הזווית, לבדוק השמות וקהלים ולהעלות איכות המרה אחרי הקליק.' : 'להחליף מסר וקריאייטיב כדי לשפר relevance score לפני הגדלת תקציב.',
            priority: auctionPressure ? 4 : 2,
            confidence: auctionPressure ? 73 : 87,
            expectedImpact: auctionPressure ? 'medium' : 'high'
        });
        addBrief(briefs, {
            assetType: 'ad',
            reason: auctionPressure ? 'לחץ מכרז' : 'רלוונטיות נמוכה',
            exactAction: auctionPressure ? 'לא לשרוף מודעות טובות; לבדוק placements וקהלים.' : 'לשכתב primary text ו-headline כך שידברו כאב, מנגנון ו-CTA אחד בלבד.',
            priority: auctionPressure ? 5 : 2
        });
    }
    if ((input.cvr ?? 0) < 2.5 || (input.bounceRate ?? 0) > 70) {
        const landingFriction = (input.bounceRate ?? 0) > 70;
        pushIssue(issues, {
            metric: 'conversion',
            severity: 'critical',
            finding: landingFriction ? 'הטראפיק נופל מיד אחרי הכניסה לדף.' : 'הדף מקבל תשומת לב אבל לא סוגר המרה.',
            rootCause: landingFriction ? 'בעיה בדף: headline חלש, message match שבור או CTA מוקדם בלי הצדקה.' : 'ההצעה חלשה יחסית לחיכוך או חסרה הוכחה.',
            businessMeaning: landingFriction ? 'הכסף נשפך אחרי הקליק.' : 'יש עניין אבל לא מספיק ביטחון כדי לבצע את הצעד הבא.',
            recommendedAction: landingFriction ? 'ליישר hero עם זווית המודעה, לשים proof מעל הקפל ולהשאיר CTA יחיד.' : 'לחזק value stack, proof ו-objection handling לפני ה-CTA.',
            priority: 1,
            confidence: landingFriction ? 92 : 84,
            expectedImpact: 'high'
        });
        addBrief(briefs, {
            assetType: 'landing_page',
            reason: landingFriction ? 'message match שבור' : 'הצעה חלשה ביחס לחיכוך',
            exactAction: landingFriction ? 'לשכתב hero, subheadline ו-CTA כך שישקפו בדיוק את ההבטחה במודעה.' : 'להוסיף proof, value stack ושבירת התנגדויות לפני ה-CTA.',
            priority: 1
        });
    }
    if ((input.leadToCallRate ?? 0) > 0 && (input.leadToCallRate ?? 0) < 20) {
        pushIssue(issues, {
            metric: 'lead_to_call',
            severity: 'medium',
            finding: 'יש לידים אבל הם לא מתקדמים לצעד המכירה הבא.',
            rootCause: 'המסר מושך סקרנים במקום מתאימים או שהסינון חלש.',
            businessMeaning: 'יש נפח בלי איכות מסחרית.',
            recommendedAction: 'להקשיח qualifying copy במודעה, בדף ובטופס.',
            priority: 3,
            confidence: 81,
            expectedImpact: 'medium'
        });
        addBrief(briefs, {
            assetType: 'landing_page',
            reason: 'לידים לא מסוננים',
            exactAction: 'להבהיר למי זה לא מתאים ולהוסיף תנאי התאמה לפני הטופס.',
            priority: 3
        });
    }
    if (!issues.length) {
        pushIssue(issues, {
            metric: 'overall',
            severity: 'low',
            finding: 'לא זוהה דפוס כשל דומיננטי.',
            rootCause: 'הקמפיין יציב יחסית.',
            businessMeaning: 'יש בסיס סביר להגדלה מדורגת.',
            recommendedAction: 'להעלות תקציב בזהירות ולבדוק בכל פעם משתנה אחד בלבד.',
            priority: 5,
            confidence: 70,
            expectedImpact: 'low'
        });
    }
    issues.sort((a, b) => a.priority - b.priority || b.confidence - a.confidence);
    briefs.sort((a, b) => a.priority - b.priority);
    const findings = issues.map((issue) => issue.finding);
    const rootCauses = issues.map((issue) => issue.rootCause);
    const recommendedActions = issues.map((issue) => issue.recommendedAction);
    const diagnosis = issues
        .map((issue) => `${issue.metric}: ${issue.finding} שורש: ${issue.rootCause} ביטחון: ${issue.confidence}% פעולה: ${issue.recommendedAction}`)
        .join(' ');
    return {
        findings,
        rootCauses,
        recommendedActions,
        priorityOrder: issues.map((issue) => `${issue.metric}:${issue.recommendedAction}`),
        issues,
        regenerationBriefs: briefs,
        professional: { diagnosis },
        plainHebrew: (0, explainLikeHuman_1.explainLikeHuman)(diagnosis)
    };
}
