import { runBusinessIntake } from './intake/businessIntakeAgent';
import { runMarketResearch } from './research/marketResearchAgent';
import { runAudienceResearch } from './research/audienceResearchAgent';
import { runPositioning } from './strategy/positioningAgent';
import { runOfferStrategy } from './strategy/offerStrategyAgent';
import { runFunnelStrategy } from './funnel/funnelStrategyAgent';
import { runLandingPageBlueprint } from './assets/landingPageArchitect';
import { runLandingPageCopy } from './assets/landingPageCopyAgent';
import { runAdCopy } from './assets/adCopyAgent';
import { runVideoScripts } from './assets/videoScriptAgent';
import { runLaunchPlan, LaunchPlan } from './launch/launchPlanner';
import {
  assertProductionReadyCampaign,
  improveAdPack,
  improveLandingCopy,
  improveVideoPack,
  qualifyAdPack,
  qualifyLandingCopy,
  qualifyVideoPack,
  validateStrategyConsistency
} from '../engine/campaignRulesEngine';
import { buildStrategyVerdict } from '../engine/verdictEngine';
import { CampaignBuildInput, CampaignBuildOutput, campaignBuildInputSchema } from '../domain/campaignBuild';
import { AdCreativePack, LandingPageBlueprint, LandingPageCopy, VideoScriptPack } from '../domain/assets';
import { validateWithSchema } from '../engine/schemaValidator';
import { HttpError } from '../utils/http';

const MAX_RETRIES = 2;

export interface CampaignBuildBundle extends CampaignBuildOutput {
  landingBlueprint: LandingPageBlueprint;
  landingCopy: LandingPageCopy;
  adPack: AdCreativePack;
  videoPack: VideoScriptPack;
  launchPlan: LaunchPlan;
  verdict: ReturnType<typeof buildStrategyVerdict>;
}

function assertAssetPassed(label: string, scoreStatus?: 'pass' | 'improve' | 'reject', reasons: string[] = []) {
  if (scoreStatus !== 'pass') {
    throw new HttpError(400, `Campaign rules rejected ${label}`, {
      reason: `${label} failed quality gate after regeneration loop`,
      details: reasons
    });
  }
}

async function buildLandingWithRetries(strategy: CampaignBuildOutput, blueprint: LandingPageBlueprint): Promise<LandingPageCopy> {
  let feedback: string[] = [];
  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt += 1) {
    const generated = await runLandingPageCopy(blueprint, strategy.audience, strategy.positioning, strategy.offer, feedback, attempt);
    const qualified = qualifyLandingCopy(strategy, attempt === 1 ? generated : improveLandingCopy(generated, strategy, feedback, attempt), attempt);
    if (qualified.qualityScore?.status === 'pass') return qualified;
    feedback = qualified.qualityScore?.reasons ?? ['landing page needs stronger clarity and specificity'];
  }
  throw new HttpError(400, 'Campaign rules rejected landing page copy', { reason: 'Landing page failed regeneration loop' });
}

async function buildAdsWithRetries(strategy: CampaignBuildOutput): Promise<AdCreativePack> {
  let feedback: string[] = [];
  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt += 1) {
    const generated = await runAdCopy(strategy.business, strategy.audience, strategy.positioning, strategy.offer, strategy.funnel, feedback, attempt);
    const candidate = attempt === 1 ? generated : improveAdPack(generated, strategy, feedback, attempt);
    const qualified = qualifyAdPack(strategy, candidate, attempt);
    if (qualified.ads.every((ad) => ad.qualityScore?.status === 'pass')) return qualified;
    feedback = qualified.ads.flatMap((ad) => ad.qualityScore?.reasons ?? []);
  }
  throw new HttpError(400, 'Campaign rules rejected ad pack', { reason: 'Ad pack failed regeneration loop' });
}

async function buildVideoWithRetries(strategy: CampaignBuildOutput): Promise<VideoScriptPack> {
  let feedback: string[] = [];
  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt += 1) {
    const generated = await runVideoScripts(strategy.business, strategy.audience, strategy.positioning, strategy.offer, feedback, attempt);
    const candidate = attempt === 1 ? generated : improveVideoPack(generated, strategy, feedback, attempt);
    const qualified = qualifyVideoPack(strategy, candidate, attempt);
    if (qualified.scripts.every((script) => script.qualityScore?.status === 'pass')) return qualified;
    feedback = qualified.scripts.flatMap((script) => script.qualityScore?.reasons ?? []);
  }
  throw new HttpError(400, 'Campaign rules rejected video script', { reason: 'Video scripts failed regeneration loop' });
}

export async function runCampaignBuild(input: CampaignBuildInput): Promise<CampaignBuildBundle> {
  const parsed = validateWithSchema(campaignBuildInputSchema, input, 'Campaign build input');
  const business = await runBusinessIntake(parsed.business);
  const market = await runMarketResearch(business);
  const audience = await runAudienceResearch(business, market);
  const positioning = await runPositioning(business, market, audience);
  const offer = await runOfferStrategy(business, market, audience, positioning);
  const funnel = await runFunnelStrategy(business, audience, positioning, offer);

  const strategy: CampaignBuildOutput = {
    business,
    market,
    audience,
    positioning,
    offer,
    funnel
  };

  validateStrategyConsistency(strategy);

  const verdict = buildStrategyVerdict(strategy);
  if (verdict.status === 'rejected') {
    throw new HttpError(400, 'Campaign rules rejected strategy', {
      reason: 'Verdict confidence too low for executable campaign output',
      verdict
    });
  }

  const landingBlueprint = await runLandingPageBlueprint(business, audience, positioning, offer, funnel);
  const landingCopy = await buildLandingWithRetries(strategy, landingBlueprint);
  const adPack = await buildAdsWithRetries(strategy);
  const videoPack = await buildVideoWithRetries(strategy);
  const launchPlan = await runLaunchPlan(business, funnel, adPack, videoPack);

  assertAssetPassed('landing page copy', landingCopy.qualityScore?.status, landingCopy.qualityScore?.reasons);
  assertAssetPassed('ad pack', adPack.iteration?.passed ? 'pass' : 'reject', adPack.iteration?.reasons);
  assertAssetPassed('video scripts', videoPack.iteration?.passed ? 'pass' : 'reject', videoPack.iteration?.reasons);
  assertProductionReadyCampaign({ strategy, landingCopy, adPack, videoPack });

  return {
    ...strategy,
    landingBlueprint,
    landingCopy,
    adPack,
    videoPack,
    launchPlan,
    verdict
  };
}
