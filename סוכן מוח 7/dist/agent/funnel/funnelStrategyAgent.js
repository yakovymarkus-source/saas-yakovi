"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runFunnelStrategy = runFunnelStrategy;
async function runFunnelStrategy(business, audience, positioning, offer) {
    const closingCta = offer.ctaType === 'book_call'
        ? 'לקביעת שיחה'
        : offer.ctaType === 'buy_now'
            ? 'לרכישה'
            : offer.ctaType === 'apply_now'
                ? 'להגשת מועמדות'
                : 'להשארת פרטים';
    return {
        topOfFunnel: ['וידאו קצר', 'מודעת כאב/בידול', 'קרוסלת מסר'],
        middleOfFunnel: ['דף נחיתה', 'עדות/הוכחה', 'מסר הבהרה'],
        bottomOfFunnel: ['CTA סופי', 'מעקב וואטסאפ', 'שבירת התנגדויות'],
        steps: [
            {
                step: 'attention',
                objective: 'לעצור את האדם הנכון',
                asset: 'ad',
                message: audience.corePersona.pains[0],
                cta: 'להיכנס ולראות'
            },
            {
                step: 'consideration',
                objective: 'להוכיח שהפתרון אחר',
                asset: 'landing_page',
                message: positioning.uniqueMechanism,
                cta: 'להמשיך'
            },
            {
                step: 'conversion',
                objective: `להוביל ${closingCta}`,
                asset: offer.ctaType === 'book_call' ? 'booking_form' : 'checkout_or_lead_form',
                message: `עכשיו מקבלים ${business.targetOutcome} בלי עוד בלבול`,
                cta: closingCta
            }
        ],
        followUpSequence: [
            { day: 0, channel: 'whatsapp', objective: 'חיזוק אמון', messageAngle: positioning.coreAngle },
            { day: 1, channel: 'email', objective: 'פירוק התנגדות', messageAngle: audience.corePersona.objections[0] },
            { day: 3, channel: 'sms', objective: 'סגירה', messageAngle: 'חלון ההחלטה לא נשאר פתוח לנצח' }
        ]
    };
}
