import { LandingPageBlueprint } from '../../domain/assets';
import { AudienceResearch, BusinessProfile, FunnelPlan, OfferStrategy, PositioningDecision } from '../../domain/campaignBuild';

export async function runLandingPageBlueprint(
  business: BusinessProfile,
  audience: AudienceResearch,
  positioning: PositioningDecision,
  offer: OfferStrategy,
  _funnel: FunnelPlan
): Promise<LandingPageBlueprint> {
  return {
    conversionGoal: offer.ctaType === 'buy_now' ? 'sale' : offer.ctaType === 'book_call' ? 'booking' : 'lead',
    sections: [
      {
        id: 'hero',
        purpose: 'לעצור, ליישר ציפייה ולהוביל לצעד הבא בלי בלבול',
        headlineGoal: positioning.promise,
        contentRequirements: [positioning.coreAngle, business.offer, 'CTA אחד ברור', audience.corePersona.deepPains?.[0] ?? audience.corePersona.pains[0]]
      },
      {
        id: 'pain',
        purpose: 'לשקף את הכאב הגלוי והעמוק כדי שהקהל יזהה את עצמו',
        headlineGoal: audience.corePersona.surfacePains?.[0] ?? audience.corePersona.pains[0],
        contentRequirements: [...(audience.corePersona.surfacePains ?? audience.corePersona.pains.slice(0, 2)), ...(audience.corePersona.deepPains ?? audience.corePersona.pains.slice(2, 4))]
      },
      {
        id: 'mechanism',
        purpose: 'להציג את המנגנון ולא רק את ההבטחה',
        headlineGoal: positioning.uniqueMechanism,
        contentRequirements: ['איך זה עובד', 'למה זה שונה', 'מה נשבר בשוק', ...positioning.messagingHierarchy.slice(0, 2)]
      },
      {
        id: 'proof',
        purpose: 'להוריד ספק עם היגיון, תהליך וסימני אמינות',
        headlineGoal: 'הוכחה לפני דרישה',
        contentRequirements: ['proof of process', positioning.proofStrategy, 'credibility proof']
      },
      {
        id: 'objections',
        purpose: 'לנטרל חסמי החלטה לפני ה-CTA',
        headlineGoal: 'לפני שאתה אומר "ראיתי כבר דבר כזה"',
        contentRequirements: audience.corePersona.objections
      },
      {
        id: 'offer',
        purpose: 'לארוז את ההצעה כך שהערך ירגיש גדול מהחיכוך',
        headlineGoal: 'מה בדיוק אתה מקבל',
        contentRequirements: offer.valueStack ?? offer.offerStructure
      },
      {
        id: 'cta',
        purpose: 'לסגור את המעבר מצפייה לפעולה',
        headlineGoal: 'החלטה במקום גלילה',
        contentRequirements: [offer.ctaType, ...(offer.valueStack ?? offer.offerStructure)]
      }
    ]
  };
}
