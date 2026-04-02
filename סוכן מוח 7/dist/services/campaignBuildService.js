"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildCampaignStrategy = buildCampaignStrategy;
exports.regenerateLandingPage = regenerateLandingPage;
exports.regenerateAds = regenerateAds;
exports.regenerateVideoScripts = regenerateVideoScripts;
exports.optimizeCampaign = optimizeCampaign;
const client_1 = require("../db/client");
const campaignsRepository_1 = require("../db/campaignsRepository");
const campaignOrchestrator_1 = require("../agent/campaignOrchestrator");
const campaignStrategyRepository_1 = require("../repositories/campaignStrategyRepository");
const assetRepository_1 = require("../repositories/assetRepository");
const optimizationRepository_1 = require("../repositories/optimizationRepository");
const landingPageArchitect_1 = require("../agent/assets/landingPageArchitect");
const landingPageCopyAgent_1 = require("../agent/assets/landingPageCopyAgent");
const adCopyAgent_1 = require("../agent/assets/adCopyAgent");
const videoScriptAgent_1 = require("../agent/assets/videoScriptAgent");
const performanceAnalyst_1 = require("../agent/optimization/performanceAnalyst");
const http_1 = require("../utils/http");
const campaignRulesEngine_1 = require("../engine/campaignRulesEngine");
async function assertCampaignOwnership(campaignId, userId) {
    const campaign = await (0, campaignsRepository_1.getCampaignById)(campaignId, userId);
    if (!campaign) {
        throw new http_1.HttpError(404, 'Campaign not found');
    }
    return campaign;
}
function latestAssetsByType(assets) {
    return assets.reduce((acc, asset) => {
        const current = acc[asset.type];
        if (!current || asset.version > current.version)
            acc[asset.type] = asset;
        return acc;
    }, {});
}
async function buildCampaignStrategy(campaignId, input, user) {
    await assertCampaignOwnership(campaignId, user.id);
    const bundle = await (0, campaignOrchestrator_1.runCampaignBuild)(input);
    await (0, client_1.withTransaction)(async (client) => {
        await (0, campaignStrategyRepository_1.saveCampaignStrategy)({
            campaignId,
            userId: user.id,
            strategyPayload: bundle,
            verdictPayload: bundle.verdict
        }, client);
        await (0, assetRepository_1.createVersionedAsset)({
            campaignId,
            userId: user.id,
            type: 'landing_page',
            angle: bundle.positioning.coreAngle,
            content: { blueprint: bundle.landingBlueprint, copy: bundle.landingCopy }
        }, client);
        await (0, assetRepository_1.createVersionedAsset)({
            campaignId,
            userId: user.id,
            type: 'ad',
            angle: bundle.positioning.coreAngle,
            content: bundle.adPack
        }, client);
        await (0, assetRepository_1.createVersionedAsset)({
            campaignId,
            userId: user.id,
            type: 'video_script',
            angle: bundle.positioning.coreAngle,
            content: bundle.videoPack
        }, client);
    });
    return {
        ...bundle,
        assets: await (0, assetRepository_1.listAssetsForCampaign)(campaignId, user.id)
    };
}
async function regenerateLandingPage(campaignId, input, user) {
    await assertCampaignOwnership(campaignId, user.id);
    const build = await (0, campaignOrchestrator_1.runCampaignBuild)(input);
    const blueprint = await (0, landingPageArchitect_1.runLandingPageBlueprint)(build.business, build.audience, build.positioning, build.offer, build.funnel);
    const copy = await (0, landingPageCopyAgent_1.runLandingPageCopy)(blueprint, build.audience, build.positioning, build.offer);
    const asset = await (0, assetRepository_1.createVersionedAsset)({
        campaignId,
        userId: user.id,
        type: 'landing_page',
        angle: build.positioning.coreAngle,
        content: { blueprint, copy }
    });
    return { asset, blueprint, copy, verdict: build.verdict };
}
async function regenerateAds(campaignId, input, user) {
    await assertCampaignOwnership(campaignId, user.id);
    const build = await (0, campaignOrchestrator_1.runCampaignBuild)(input);
    const adPack = await (0, adCopyAgent_1.runAdCopy)(build.business, build.audience, build.positioning, build.offer, build.funnel);
    const asset = await (0, assetRepository_1.createVersionedAsset)({
        campaignId,
        userId: user.id,
        type: 'ad',
        angle: build.positioning.coreAngle,
        content: adPack
    });
    return { asset, adPack, verdict: build.verdict };
}
async function regenerateVideoScripts(campaignId, input, user) {
    await assertCampaignOwnership(campaignId, user.id);
    const build = await (0, campaignOrchestrator_1.runCampaignBuild)(input);
    const videoPack = await (0, videoScriptAgent_1.runVideoScripts)(build.business, build.audience, build.positioning, build.offer);
    const asset = await (0, assetRepository_1.createVersionedAsset)({
        campaignId,
        userId: user.id,
        type: 'video_script',
        angle: build.positioning.coreAngle,
        content: videoPack
    });
    return { asset, videoPack, verdict: build.verdict };
}
async function optimizeCampaign(campaignId, input, user) {
    await assertCampaignOwnership(campaignId, user.id);
    const diagnosis = await (0, performanceAnalyst_1.runPerformanceAnalysis)(input);
    const saved = await (0, optimizationRepository_1.saveOptimizationRun)({
        campaignId,
        userId: user.id,
        inputPayload: input,
        diagnosisPayload: diagnosis
    });
    const assets = await (0, assetRepository_1.listAssetsForCampaign)(campaignId, user.id);
    const latest = latestAssetsByType(assets);
    const regeneratedAssets = [];
    for (const assetType of ['landing_page', 'ad', 'video_script']) {
        const current = latest[assetType];
        const hasRelevantBrief = diagnosis.regenerationBriefs?.some((brief) => brief.assetType === assetType || (assetType === 'ad' && brief.assetType === 'ad'));
        if (!current || !hasRelevantBrief)
            continue;
        const improvedContent = (0, campaignRulesEngine_1.improveAssetFromDiagnosis)(assetType, current.content, diagnosis);
        const nextAsset = await (0, assetRepository_1.createVersionedAsset)({
            campaignId,
            userId: user.id,
            type: assetType,
            angle: current.angle,
            content: {
                ...(improvedContent ?? {}),
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
