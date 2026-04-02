"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchMetaMetrics = fetchMetaMetrics;
const env_1 = require("../config/env");
const baseClient_1 = require("./baseClient");
async function fetchMetaMetrics(externalCampaignId) {
    if (!env_1.env.META_ACCESS_TOKEN || !env_1.env.META_AD_ACCOUNT_ID) {
        throw new Error('Meta integration is not configured');
    }
    const fields = ['impressions', 'clicks', 'spend', 'landing_page_views', 'actions', 'purchase_roas', 'frequency'];
    const url = `https://graph.facebook.com/v21.0/${externalCampaignId}/insights?fields=${fields.join(',')}&access_token=${encodeURIComponent(env_1.env.META_ACCESS_TOKEN)}`;
    const response = await (0, baseClient_1.externalGet)('meta', url, { Accept: 'application/json' });
    const row = response.data?.[0];
    if (!row)
        throw new Error('No Meta campaign insights returned');
    const actions = Array.isArray(row.actions)
        ? (row.actions ?? [])
        : [];
    const actionValue = (type) => Number(actions.find((item) => item.action_type === type)?.value ?? 0);
    return {
        impressions: Number(row.impressions ?? 0),
        clicks: Number(row.clicks ?? 0),
        spend: Number(row.spend ?? 0),
        landingPageViews: actionValue('landing_page_view'),
        leads: actionValue('lead'),
        purchases: actionValue('purchase'),
        frequency: Number(row.frequency ?? 0),
        revenue: Number((row.purchase_roas ?? [])[0]?.value ?? 0) * Number(row.spend ?? 0)
    };
}
