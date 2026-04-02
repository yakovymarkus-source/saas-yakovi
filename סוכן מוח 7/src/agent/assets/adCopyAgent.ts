import { AdCreativePack } from '../../domain/assets';
import { AudienceResearch, BusinessProfile, FunnelPlan, OfferStrategy, PositioningDecision } from '../../domain/campaignBuild';

const platforms: Array<'facebook' | 'instagram' | 'tiktok' | 'google'> = ['facebook', 'instagram', 'tiktok', 'google'];

export async function runAdCopy(
  business: BusinessProfile,
  audience: AudienceResearch,
  positioning: PositioningDecision,
  offer: OfferStrategy,
  funnel: FunnelPlan,
  feedback: string[] = [],
  attempt = 1
): Promise<AdCreativePack> {
  const cta =
    offer.ctaType === 'buy_now' ? 'לקנייה עכשיו' :
    offer.ctaType === 'book_call' ? 'לקביעת שיחה' :
    offer.ctaType === 'apply_now' ? 'להגשת מועמדות' :
    'להשארת פרטים';

  const pain = audience.corePersona.pains;
  const proof = positioning.proofStrategy;
  const repairLine = feedback.length ? feedback.join(' | ') : 'מסר חד, קונקרטי ומדויק';
  const hooks = [
    `${pain[0]}? הבעיה היא לא עוד מידע. הבעיה היא מסר שלא פוגע בכאב הנכון.`,
    `אם ${business.targetOutcome} עדיין לא קורה — משהו בדרך שבה אתה מציג את ההצעה שבור.`,
    `קהל ${audience.corePersona.label} לא צריך עוד רעש. הוא צריך מנגנון שמסדר החלטה.`,
    `לפני עוד קליק יקר, תבדוק אם ההצעה שלך בכלל בנויה לצעד הבא.`
  ];
  const themes = ['pain_diagnosis', 'conversion_gap', 'persona_match', 'cost_pressure'];
  const stages = ['problem_aware', 'solution_aware', audience.awarenessLevel, audience.awarenessLevel];

  return {
    ads: platforms.map((platform, index) => ({
      platform,
      angle: positioning.coreAngle,
      hook: hooks[index],
      primaryText: `${audience.corePersona.label}. ${pain[index % pain.length]}. ${positioning.uniqueMechanism}. ${funnel.steps[1]?.message ?? positioning.promise}. ${proof}. ${repairLine}.`,
      headline: `${positioning.promise} | ${business.targetOutcome}`,
      description: `לקהל: ${audience.corePersona.label} | שלב: ${stages[index]} | CTA: ${cta}`,
      cta,
      awarenessStage: stages[index],
      variationTheme: themes[index],
      versionLabel: `v${attempt}.${index + 1}`
    }))
  };
}
