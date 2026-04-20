import { AudienceResearch, BusinessProfile, MarketResearch, PositioningDecision } from '../../domain/campaignBuild';

export async function runPositioning(
  business: BusinessProfile,
  market: MarketResearch,
  audience: AudienceResearch
): Promise<PositioningDecision> {
  const tone: PositioningDecision['tone'] =
    business.pricing.amount && business.pricing.amount > 2500
      ? 'premium'
      : business.goals.primary === 'awareness'
        ? 'empathetic'
        : 'direct';

  const uniqueMechanism = `${business.businessName} מסדר את הדרך ל-${business.targetOutcome} דרך תהליך החלטה ברור במקום עוד עומס מידע`;
  const promise = `להעביר את הלקוח מבלבול לבהירות סביב ${business.targetOutcome}`;
  const coreAngle = market.marketStage === 'educational'
    ? 'לפני שמוכרים - מסדרים ללקוח את הראש'
    : 'לא עוד פתרון כללי. מנגנון חד שמוביל לתוצאה';

  return {
    categoryFrame: `${business.category} עם דגש על החלטה ותוצאה`,
    uniqueMechanism,
    enemy: 'רעש שיווקי, מסרים גנריים ופתרונות ללא הוכחה',
    promise,
    proofStrategy: 'להראות תהליך, היגיון ותוצר מוחשי במקום סיסמאות',
    tone,
    coreAngle,
    messagingHierarchy: [
      audience.corePersona.pains[0],
      uniqueMechanism,
      promise,
      'הוכחה קצרה',
      'CTA אחד ברור'
    ]
  };
}
