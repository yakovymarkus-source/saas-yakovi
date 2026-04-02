"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runLaunchPlan = runLaunchPlan;
async function runLaunchPlan(business, funnel, adPack, videoPack) {
    const testBudget = business.budget.testBudget ?? Math.max(500, Math.round((business.budget.monthly ?? 3000) * 0.25));
    return {
        campaignObjective: business.goals.primary,
        firstWeekPlan: [
            'להעלות 2 מודעות עם אותו קהל וזוויות שונות',
            'להשיק דף נחיתה אחד בלי פיצולים מיותרים',
            'לבדוק עצירה, הקלקה, מעבר לדף ו-CTA',
            'לחתוך מהר מודעה חלשה ולא להתאהב ביצירה'
        ],
        testMatrix: [
            { variable: 'angle', variants: [...new Set(adPack.ads.map((ad) => ad.angle))] },
            { variable: 'hook', variants: videoPack.scripts.map((script) => script.hook) },
            { variable: 'creative', variants: ['UGC', 'Founder', 'Direct response'] },
            { variable: 'offer', variants: funnel.followUpSequence.map((step) => step.messageAngle) }
        ],
        budgetAllocation: [
            { item: 'paid_social_test', amount: Math.round(testBudget * 0.7) },
            { item: 'retargeting', amount: Math.round(testBudget * 0.2) },
            { item: 'creative_iteration', amount: Math.round(testBudget * 0.1) }
        ]
    };
}
