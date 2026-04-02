"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runOfferStrategy = runOfferStrategy;
async function runOfferStrategy(business, market, audience, positioning) {
    const price = business.pricing.amount ?? 0;
    const premium = price >= 1000;
    const trustLevel = audience.awarenessLevel === 'product_aware' || audience.awarenessLevel === 'most_aware'
        ? 'high'
        : premium || market.marketStage === 'red_ocean'
            ? 'medium'
            : 'low';
    const callDriven = business.goals.primary === 'appointments' || (premium && trustLevel !== 'high');
    const offerType = business.goals.primary === 'leads'
        ? 'lead_magnet'
        : callDriven
            ? 'call_booking'
            : business.goals.primary === 'sales' && price < 1000
                ? 'core_offer'
                : 'application';
    const ctaType = offerType === 'call_booking'
        ? 'book_call'
        : offerType === 'application'
            ? 'apply_now'
            : business.goals.primary === 'sales'
                ? 'buy_now'
                : 'leave_details';
    const valueStack = [
        `הצעה: ${business.offer}`,
        positioning.uniqueMechanism,
        'הוכחה קצרה שמצמצמת ספק לפני החלטה',
        `בונוס יישום שמחזק את ${business.targetOutcome}`,
        'CTA אחד בלי פיצול קשב'
    ];
    const weakPoints = [];
    if (premium && ctaType === 'buy_now')
        weakPoints.push('מחיר גבוה מדי לרכישה קרה ישירה.');
    if (trustLevel === 'low' && !valueStack.some((item) => /הוכחה|proof/i.test(item)))
        weakPoints.push('אין מספיק הוכחה בשלב מוקדם.');
    if (audience.awarenessLevel === 'problem_aware' && ctaType === 'buy_now')
        weakPoints.push('הקהל עדיין לא בשל לרכישה ישירה.');
    return {
        offerType,
        trustLevel,
        pricingStrategy: premium
            ? 'לשמור על מחיר פרימיום ולהצדיק אותו דרך תהליך, הוכחה וסינון רצינות.'
            : 'להקטין חיכוך דרך כניסה קלה ואז להעלות ערך בלי למכור בזול את האמון.',
        bonuses: [
            'צ׳קליסט יישום קצר',
            'מסמך מפת החלטה',
            `פירוק התנגדויות סביב ${audience.corePersona.label}`
        ],
        guarantee: callDriven ? undefined : 'אחריות סבירה מבוססת מסגרת ותנאים, בלי הבטחות הזויות',
        urgencyMechanism: premium ? 'חלון אבחון מוגבל לפי קיבולת אמיתית' : 'חלון בדיקה מוגבל בזמן עם סיבה אמיתית לפעול עכשיו',
        ctaType,
        valueStack,
        weakPoints,
        offerStructure: [
            positioning.coreAngle,
            ...valueStack,
            premium && callDriven ? 'שיחה קצרה לסינון והתאמה' : 'מסלול כניסה מהיר',
            'פירוק התנגדויות',
            'CTA אחד'
        ]
    };
}
