import { BusinessProfile, AudienceResearch, MarketResearch, OfferStrategy, PositioningDecision } from '../domain/campaignBuild';

export function composePromptContext(input: {
  business: BusinessProfile;
  market: MarketResearch;
  audience: AudienceResearch;
  positioning: PositioningDecision;
  offer: OfferStrategy;
}): string {
  return JSON.stringify(input, null, 2);
}
