"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runCampaignBuild = runCampaignBuild;
const businessIntakeAgent_1 = require("./intake/businessIntakeAgent");
const marketResearchAgent_1 = require("./research/marketResearchAgent");
const audienceResearchAgent_1 = require("./research/audienceResearchAgent");
const positioningAgent_1 = require("./strategy/positioningAgent");
const offerStrategyAgent_1 = require("./strategy/offerStrategyAgent");
const funnelStrategyAgent_1 = require("./funnel/funnelStrategyAgent");
const landingPageArchitect_1 = require("./assets/landingPageArchitect");
const landingPageCopyAgent_1 = require("./assets/landingPageCopyAgent");
const adCopyAgent_1 = require("./assets/adCopyAgent");
const videoScriptAgent_1 = require("./assets/videoScriptAgent");
const launchPlanner_1 = require("./launch/launchPlanner");
const campaignRulesEngine_1 = require("../engine/campaignRulesEngine");
const verdictEngine_1 = require("../engine/verdictEngine");
const campaignBuild_1 = require("../domain/campaignBuild");
const schemaValidator_1 = require("../engine/schemaValidator");
const http_1 = require("../utils/http");
const MAX_RETRIES = 2;
function assertAssetPassed(label, scoreStatus, reasons = []) {
    if (scoreStatus !== 'pass') {
        throw new http_1.HttpError(400, `Campaign rules rejected ${label}`, {
            reason: `${label} failed quality gate after regeneration loop`,
            details: reasons
        });
    }
}
async function buildLandingWithRetries(strategy, blueprint) {
    let feedback = [];
    for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt += 1) {
        const generated = await (0, landingPageCopyAgent_1.runLandingPageCopy)(blueprint, strategy.audience, strategy.positioning, strategy.offer, feedback, attempt);
        const qualified = (0, campaignRulesEngine_1.qualifyLandingCopy)(strategy, attempt === 1 ? generated : (0, campaignRulesEngine_1.improveLandingCopy)(generated, strategy, feedback, attempt), attempt);
        if (qualified.qualityScore?.status === 'pass')
            return qualified;
        feedback = qualified.qualityScore?.reasons ?? ['landing page needs stronger clarity and specificity'];
    }
    throw new http_1.HttpError(400, 'Campaign rules rejected landing page copy', { reason: 'Landing page failed regeneration loop' });
}
async function buildAdsWithRetries(strategy) {
    let feedback = [];
    for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt += 1) {
        const generated = await (0, adCopyAgent_1.runAdCopy)(strategy.business, strategy.audience, strategy.positioning, strategy.offer, strategy.funnel, feedback, attempt);
        const candidate = attempt === 1 ? generated : (0, campaignRulesEngine_1.improveAdPack)(generated, strategy, feedback, attempt);
        const qualified = (0, campaignRulesEngine_1.qualifyAdPack)(strategy, candidate, attempt);
        if (qualified.ads.every((ad) => ad.qualityScore?.status === 'pass'))
            return qualified;
        feedback = qualified.ads.flatMap((ad) => ad.qualityScore?.reasons ?? []);
    }
    throw new http_1.HttpError(400, 'Campaign rules rejected ad pack', { reason: 'Ad pack failed regeneration loop' });
}
async function buildVideoWithRetries(strategy) {
    let feedback = [];
    for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt += 1) {
        const generated = await (0, videoScriptAgent_1.runVideoScripts)(strategy.business, strategy.audience, strategy.positioning, strategy.offer, feedback, attempt);
        const candidate = attempt === 1 ? generated : (0, campaignRulesEngine_1.improveVideoPack)(generated, strategy, feedback, attempt);
        const qualified = (0, campaignRulesEngine_1.qualifyVideoPack)(strategy, candidate, attempt);
        if (qualified.scripts.every((script) => script.qualityScore?.status === 'pass'))
            return qualified;
        feedback = qualified.scripts.flatMap((script) => script.qualityScore?.reasons ?? []);
    }
    throw new http_1.HttpError(400, 'Campaign rules rejected video script', { reason: 'Video scripts failed regeneration loop' });
}
async function runCampaignBuild(input) {
    const parsed = (0, schemaValidator_1.validateWithSchema)(campaignBuild_1.campaignBuildInputSchema, input, 'Campaign build input');
    const business = await (0, businessIntakeAgent_1.runBusinessIntake)(parsed.business);
    const market = await (0, marketResearchAgent_1.runMarketResearch)(business);
    const audience = await (0, audienceResearchAgent_1.runAudienceResearch)(business, market);
    const positioning = await (0, positioningAgent_1.runPositioning)(business, market, audience);
    const offer = await (0, offerStrategyAgent_1.runOfferStrategy)(business, market, audience, positioning);
    const funnel = await (0, funnelStrategyAgent_1.runFunnelStrategy)(business, audience, positioning, offer);
    const strategy = {
        business,
        market,
        audience,
        positioning,
        offer,
        funnel
    };
    (0, campaignRulesEngine_1.validateStrategyConsistency)(strategy);
    const verdict = (0, verdictEngine_1.buildStrategyVerdict)(strategy);
    if (verdict.status === 'rejected') {
        throw new http_1.HttpError(400, 'Campaign rules rejected strategy', {
            reason: 'Verdict confidence too low for executable campaign output',
            verdict
        });
    }
    const landingBlueprint = await (0, landingPageArchitect_1.runLandingPageBlueprint)(business, audience, positioning, offer, funnel);
    const landingCopy = await buildLandingWithRetries(strategy, landingBlueprint);
    const adPack = await buildAdsWithRetries(strategy);
    const videoPack = await buildVideoWithRetries(strategy);
    const launchPlan = await (0, launchPlanner_1.runLaunchPlan)(business, funnel, adPack, videoPack);
    assertAssetPassed('landing page copy', landingCopy.qualityScore?.status, landingCopy.qualityScore?.reasons);
    assertAssetPassed('ad pack', adPack.iteration?.passed ? 'pass' : 'reject', adPack.iteration?.reasons);
    assertAssetPassed('video scripts', videoPack.iteration?.passed ? 'pass' : 'reject', videoPack.iteration?.reasons);
    (0, campaignRulesEngine_1.assertProductionReadyCampaign)({ strategy, landingCopy, adPack, videoPack });
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
