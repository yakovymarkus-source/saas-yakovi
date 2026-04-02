"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchGoogleAdsMetrics = fetchGoogleAdsMetrics;
const env_1 = require("../config/env");
const baseClient_1 = require("./baseClient");
async function fetchGoogleAdsMetrics(_externalCampaignId) {
    if (!env_1.env.GOOGLE_ADS_DEVELOPER_TOKEN || !env_1.env.GOOGLE_ADS_ACCESS_TOKEN || !env_1.env.GOOGLE_ADS_CUSTOMER_ID) {
        throw new Error('Google Ads integration is not configured');
    }
    const query = encodeURIComponent('SELECT metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value FROM campaign');
    const url = `https://googleads.googleapis.com/v18/customers/${env_1.env.GOOGLE_ADS_CUSTOMER_ID}/googleAds:searchStream?query=${query}`;
    const response = await (0, baseClient_1.externalGet)('googleAds', url, {
        Accept: 'application/json',
        Authorization: `Bearer ${env_1.env.GOOGLE_ADS_ACCESS_TOKEN}`,
        'developer-token': env_1.env.GOOGLE_ADS_DEVELOPER_TOKEN
    });
    const metrics = response[0]?.results?.[0]?.metrics;
    if (!metrics)
        throw new Error('No Google Ads metrics returned');
    return {
        impressions: Number(metrics.impressions ?? 0),
        clicks: Number(metrics.clicks ?? 0),
        spend: Number(metrics.costMicros ?? 0) / 1_000_000,
        leads: Number(metrics.conversions ?? 0),
        revenue: Number(metrics.conversionsValue ?? 0)
    };
}
