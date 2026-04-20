import { runCampaignBuild, CampaignBuildBundle } from '../agent/campaignOrchestrator';
import { runLandingPageBlueprint } from '../agent/assets/landingPageArchitect';
import { runLandingPageCopy } from '../agent/assets/landingPageCopyAgent';
import { runAdCopy } from '../agent/assets/adCopyAgent';
import { runVideoScripts } from '../agent/assets/videoScriptAgent';
import { runPerformanceAnalysis } from '../agent/optimization/performanceAnalyst';
import { CampaignBuildInput } from '../domain/campaignBuild';
import { AuthenticatedUser } from '../types/domain';
import { PerformanceInput } from '../domain/optimization';

export async function buildCampaignStrategy(
  _campaignId: string,
  input: CampaignBuildInput,
  _user: AuthenticatedUser
): Promise<CampaignBuildBundle> {
  return runCampaignBuild(input);
}

export async function regenerateLandingPage(
  _campaignId: string,
  input: CampaignBuildInput,
  _user: AuthenticatedUser
): Promise<object> {
  const bundle = await runCampaignBuild(input);
  return { blueprint: bundle.landingBlueprint, copy: bundle.landingCopy };
}

export async function regenerateAds(
  _campaignId: string,
  input: CampaignBuildInput,
  _user: AuthenticatedUser
): Promise<object> {
  const bundle = await runCampaignBuild(input);
  return { adPack: bundle.adPack };
}

export async function regenerateVideoScripts(
  _campaignId: string,
  input: CampaignBuildInput,
  _user: AuthenticatedUser
): Promise<object> {
  const bundle = await runCampaignBuild(input);
  return { videoPack: bundle.videoPack };
}

export async function optimizeCampaign(
  _campaignId: string,
  input: PerformanceInput,
  _user: AuthenticatedUser
): Promise<object> {
  return runPerformanceAnalysis(input);
}
