"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveMetrics = resolveMetrics;
const schemas_1 = require("./schemas");
const metaClient_1 = require("./metaClient");
const googleAdsClient_1 = require("./googleAdsClient");
const ga4Client_1 = require("./ga4Client");
async function resolveMetrics(input) {
    let rawMetrics = input.campaign.manualMetrics;
    if (!rawMetrics && input.externalCampaignId) {
        rawMetrics = await (input.source === 'meta'
            ? (0, metaClient_1.fetchMetaMetrics)(input.externalCampaignId)
            : input.source === 'googleAds'
                ? (0, googleAdsClient_1.fetchGoogleAdsMetrics)(input.externalCampaignId)
                : (0, ga4Client_1.fetchGa4Metrics)());
    }
    if (!rawMetrics) {
        throw new Error('No metrics available. Provide manualMetrics or a valid external campaign id.');
    }
    return schemas_1.rawMetricsSchema.parse(rawMetrics);
}
