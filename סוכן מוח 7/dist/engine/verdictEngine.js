"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildStrategyVerdict = buildStrategyVerdict;
function scoreConfidence(strategy) {
    let score = 60;
    if ((strategy.audience.corePersona.deepPains ?? []).length >= 2)
        score += 8;
    if ((strategy.market.whitespaceOpportunities ?? []).length > 0)
        score += 7;
    if ((strategy.offer.weakPoints ?? []).length === 0)
        score += 10;
    if (strategy.offer.ctaType === 'book_call' && (strategy.business.pricing.amount ?? 0) >= 1000)
        score += 8;
    if (strategy.offer.ctaType === 'buy_now' && (strategy.business.pricing.amount ?? 0) <= 500)
        score += 8;
    if (strategy.audience.awarenessLevel === 'product_aware' || strategy.audience.awarenessLevel === 'most_aware')
        score += 5;
    if (strategy.market.marketStage === 'red_ocean')
        score -= 8;
    if ((strategy.business.constraints ?? []).length >= 3)
        score -= 5;
    return Math.max(0, Math.min(100, score));
}
function buildStrategyVerdict(strategy) {
    const confidenceScore = scoreConfidence(strategy);
    const funnelType = strategy.funnel.steps.map((step) => step.asset).join(' → ');
    const ctaDirection = strategy.funnel.steps[strategy.funnel.steps.length - 1]?.cta ?? strategy.offer.ctaType;
    const rejectedOptions = [
        strategy.offer.ctaType === 'buy_now'
            ? 'נפסלה אסטרטגיית שיחת מכירה כי החיכוך היה מאט רכישה ישירה.'
            : 'נפסלה רכישה מיידית כי האמון הנדרש עדיין לא מספיק גבוה.',
        strategy.audience.awarenessLevel === 'problem_aware'
            ? 'נפסל מסר מוצרי מדי כי הקהל עוד לא בשל לקפוץ לפתרון.'
            : 'נפסל חינוך שוק ארוך כי הקהל כבר בשל לצעד ברור.',
        strategy.market.marketStage === 'red_ocean'
            ? 'נפסלו מסרים כלליים כי בשוק רווי הם נבלעים מיד.'
            : 'נפסלה פרובוקציה ריקה כי אין לה הצדקה מול תנאי השוק.'
    ];
    const reasoning = [
        `הפרסונה שנבחרה היא ${strategy.audience.corePersona.label} כי הכאב המרכזי שלה הוא ${strategy.audience.corePersona.pains[0]} וזה מתחבר ישירות להצעה בלי צורך בהסבר עקום.`,
        `הזווית שנבחרה היא "${strategy.positioning.coreAngle}" כי היא עוקפת את ${strategy.positioning.enemy} ומתרגמת את ההצעה למסר מסחרי שאפשר להפעיל במודעה, בדף ובשיחת המשך בלי להחליף שפה באמצע.`,
        `מבנה ההצעה נבחר כ-${strategy.offer.offerType} עם CTA ${strategy.offer.ctaType} כי רמת המודעות היא ${strategy.audience.awarenessLevel} והמחיר ${strategy.business.pricing.amount ?? 'לא צוין'} ${strategy.business.pricing.currency}, לכן זה החיכוך הסביר ביותר לסגירה.`,
        `המשפך שנבחר הוא ${funnelType} כי הוא מיישר קו בין הזווית, רמת האמון הנדרשת והצעד הבא שהקהל מוכן לבצע בפועל.`
    ];
    if (confidenceScore < 70) {
        return {
            targetAudience: strategy.audience.corePersona.label,
            angle: strategy.positioning.coreAngle,
            offerType: strategy.offer.offerType,
            funnelType,
            landingPageType: strategy.offer.ctaType === 'buy_now' ? 'sales page' : 'lead capture page',
            firstAssetToLaunch: 'none',
            reasoning: [...reasoning, 'המערכת דחתה את האסטרטגיה כי רמת הביטחון נמוכה מדי לביצוע מסחרי אחראי.'],
            rejectedOptions,
            confidenceScore,
            ctaDirection,
            status: 'rejected'
        };
    }
    return {
        targetAudience: strategy.audience.corePersona.label,
        angle: strategy.positioning.coreAngle,
        offerType: strategy.offer.offerType,
        funnelType,
        landingPageType: strategy.offer.ctaType === 'buy_now' ? 'sales page' : strategy.offer.ctaType === 'book_call' ? 'booking page' : 'lead capture page',
        firstAssetToLaunch: strategy.offer.ctaType === 'buy_now' ? 'direct-response video' : strategy.offer.ctaType === 'book_call' ? 'lead ad + booking page' : 'lead ad + landing page',
        reasoning,
        rejectedOptions,
        confidenceScore,
        ctaDirection,
        status: 'approved'
    };
}
