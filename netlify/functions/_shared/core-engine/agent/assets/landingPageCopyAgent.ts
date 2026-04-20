import { LandingPageBlueprint, LandingPageCopy } from '../../domain/assets';
import { AudienceResearch, OfferStrategy, PositioningDecision } from '../../domain/campaignBuild';

export async function runLandingPageCopy(
  blueprint: LandingPageBlueprint,
  audience: AudienceResearch,
  positioning: PositioningDecision,
  offer: OfferStrategy,
  feedback: string[] = [],
  attempt = 1
): Promise<LandingPageCopy> {
  const cta =
    offer.ctaType === 'book_call' ? 'לקביעת שיחת אבחון' :
    offer.ctaType === 'buy_now' ? 'לקנייה עכשיו' :
    offer.ctaType === 'apply_now' ? 'להגשת מועמדות' :
    'להשארת פרטים';

  const persona = audience.corePersona.label;
  const proof = positioning.proofStrategy;
  const pain = audience.corePersona.deepPains?.[0] ?? audience.corePersona.pains[0];
  const reasonLine = feedback.length ? `תיקון איכות: ${feedback.join(' | ')}.` : 'בלי מילים ריקות ובלי הבטחות מרוחות.';

  return {
    heroHeadline: `${positioning.promise} עבור ${persona} בלי להיתקע בעוד מסר כללי`,
    heroSubheadline: `${positioning.coreAngle}. ${positioning.uniqueMechanism}. ${proof}. ${reasonLine}`,
    bullets: [
      `${persona}: ${audience.corePersona.desires[0]}`,
      `הכאב שמטופל כאן: ${pain}`,
      `מהלך ברור: ${(offer.valueStack ?? offer.offerStructure).slice(0, 3).join(' → ')}`,
      `CTA יחיד: ${cta}`
    ],
    bodySections: blueprint.sections.map((section, index) => ({
      title: section.headlineGoal,
      body: `${section.purpose}. ${section.contentRequirements.join('. ')}. ${index === 0 ? `הקהל הוא ${persona}.` : proof}${attempt > 1 ? ` ניסיון ${attempt}.` : ''}`
    })),
    ctas: [cta],
    faq: [
      { q: 'למי זה מתאים?', a: `${persona}. במיוחד למי שסוחב את ${pain}.` },
      { q: 'מה שונה כאן?', a: `${positioning.uniqueMechanism}. ${proof}.` },
      { q: 'מה השלב הבא?', a: `${cta} ואז ממשיכים לפי המבנה: ${(offer.valueStack ?? offer.offerStructure).join(' → ')}` }
    ]
  };
}
