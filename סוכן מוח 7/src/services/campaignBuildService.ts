import { withTransaction } from '../db/client';
import { getCampaignById } from '../db/campaignsRepository';
import { runCampaignBuild } from '../agent/campaignOrchestrator';
import { saveCampaignStrategy } from '../repositories/campaignStrategyRepository';
import { createVersionedAsset, listAssetsForCampaign } from '../repositories/assetRepository';
import { saveOptimizationRun } from '../repositories/optimizationRepository';
import { runLandingPageBlueprint } from '../agent/assets/landingPageArchitect';
import { runLandingPageCopy } from '../agent/assets/landingPageCopyAgent';
import { runAdCopy } from '../agent/assets/adCopyAgent';
import { runVideoScripts } from '../agent/assets/videoScriptAgent';
import { runPerformanceAnalysis } from '../agent/optimization/performanceAnalyst';
import { CampaignBuildInput } from '../domain/campaignBuild';
import { HttpError } from '../utils/http';
import { AuthenticatedUser } from '../types/domain';
import { PerformanceInput } from '../domain/optimization';
import { improveAssetFromDiagnosis } from '../engine/campaignRulesEngine';
import { CampaignAssetType, VersionedAsset } from '../domain/assets';

async function assertCampaignOwnership(campaignId: string, userId: string) {
  const campaign = await getCampaignById(campaignId, userId);
  if (!campaign) {
    throw new HttpError(404, 'Campaign not found');
  }
  return campaign;
}

function latestAssetsByType(assets: VersionedAsset[]): Partial<Record<CampaignAssetType, VersionedAsset>> {
  return assets.reduce((acc, asset) => {
    const current = acc[asset.type];
    if (!current || asset.version > current.version) acc[asset.type] = asset;
    return acc;
  }, {} as Partial<Record<CampaignAssetType, VersionedAsset>>);
}

export async function buildCampaignStrategy(campaignId: string, input: CampaignBuildInput, user: AuthenticatedUser) {
  await assertCampaignOwnership(campaignId, user.id);
  const bundle = await runCampaignBuild(input);

  await withTransaction(async (client) => {
    await saveCampaignStrategy(
      {
        campaignId,
        userId: user.id,
        strategyPayload: bundle,
        verdictPayload: bundle.verdict
      },
      client
    );
    await createVersionedAsset(
      {
        campaignId,
        userId: user.id,
        type: 'landing_page',
        angle: bundle.positioning.coreAngle,
        content: { blueprint: bundle.landingBlueprint, copy: bundle.landingCopy }
      },
      client
    );
    await createVersionedAsset(
      {
        campaignId,
        userId: user.id,
        type: 'ad',
        angle: bundle.positioning.coreAngle,
        content: bundle.adPack
      },
      client
    );
    await createVersionedAsset(
      {
        campaignId,
        userId: user.id,
        type: 'video_script',
        angle: bundle.positioning.coreAngle,
        content: bundle.videoPack
      },
      client
    );
  });

  return {
    ...bundle,
    assets: await listAssetsForCampaign(campaignId, user.id)
  };
}

export async function regenerateLandingPage(campaignId: string, input: CampaignBuildInput, user: AuthenticatedUser) {
  await assertCampaignOwnership(campaignId, user.id);
  const build = await runCampaignBuild(input);
  const blueprint = await runLandingPageBlueprint(build.business, build.audience, build.positioning, build.offer, build.funnel);
  const copy = await runLandingPageCopy(blueprint, build.audience, build.positioning, build.offer);

  const asset = await createVersionedAsset({
    campaignId,
    userId: user.id,
    type: 'landing_page',
    angle: build.positioning.coreAngle,
    content: { blueprint, copy }
  });

  return { asset, blueprint, copy, verdict: build.verdict };
}

export async function regenerateAds(campaignId: string, input: CampaignBuildInput, user: AuthenticatedUser) {
  await assertCampaignOwnership(campaignId, user.id);
  const build = await runCampaignBuild(input);
  const adPack = await runAdCopy(build.business, build.audience, build.positioning, build.offer, build.funnel);
  const asset = await createVersionedAsset({
    campaignId,
    userId: user.id,
    type: 'ad',
    angle: build.positioning.coreAngle,
    content: adPack
  });
  return { asset, adPack, verdict: build.verdict };
}

export async function regenerateVideoScripts(campaignId: string, input: CampaignBuildInput, user: AuthenticatedUser) {
  await assertCampaignOwnership(campaignId, user.id);
  const build = await runCampaignBuild(input);
  const videoPack = await runVideoScripts(build.business, build.audience, build.positioning, build.offer);
  const asset = await createVersionedAsset({
    campaignId,
    userId: user.id,
    type: 'video_script',
    angle: build.positioning.coreAngle,
    content: videoPack
  });
  return { asset, videoPack, verdict: build.verdict };
}

export async function optimizeCampaign(campaignId: string, input: PerformanceInput, user: AuthenticatedUser) {
  await assertCampaignOwnership(campaignId, user.id);
  const diagnosis = await runPerformanceAnalysis(input);
  const saved = await saveOptimizationRun({
    campaignId,
    userId: user.id,
    inputPayload: input,
    diagnosisPayload: diagnosis
  });

  const assets = await listAssetsForCampaign(campaignId, user.id);
  const latest = latestAssetsByType(assets);
  const regeneratedAssets: VersionedAsset[] = [];

  for (const assetType of ['landing_page', 'ad', 'video_script'] as const) {
    const current = latest[assetType];
    const hasRelevantBrief = diagnosis.regenerationBriefs?.some((brief) => brief.assetType === assetType || (assetType === 'ad' && brief.assetType === 'ad'));
    if (!current || !hasRelevantBrief) continue;

    const improvedContent = improveAssetFromDiagnosis(assetType, current.content, diagnosis);
    const nextAsset = await createVersionedAsset({
      campaignId,
      userId: user.id,
      type: assetType,
      angle: current.angle,
      content: {
        ...((improvedContent as object) ?? {}),
        optimizationMeta: {
          sourceVersion: current.version,
          optimizationRunId: saved.id,
          generatedFromDiagnosis: diagnosis.issues?.slice(0, 2).map((issue) => issue.metric) ?? []
        }
      }
    });
    regeneratedAssets.push(nextAsset);
  }

  return { diagnosis, saved, regeneratedAssets };
}
