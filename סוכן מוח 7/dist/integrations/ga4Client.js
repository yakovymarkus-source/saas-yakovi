"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchGa4Metrics = fetchGa4Metrics;
const env_1 = require("../config/env");
const http_1 = require("../utils/http");
async function fetchGa4Metrics() {
    if (!env_1.env.GA4_PROPERTY_ID || !env_1.env.GA4_ACCESS_TOKEN) {
        throw new Error('GA4 integration is not configured');
    }
    const url = `https://analyticsdata.googleapis.com/v1beta/properties/${env_1.env.GA4_PROPERTY_ID}:runReport`;
    const response = await (0, http_1.fetchJson)(url, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${env_1.env.GA4_ACCESS_TOKEN}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
            metrics: [{ name: 'sessions' }, { name: 'bounceRate' }, { name: 'conversions' }, { name: 'purchaseRevenue' }]
        })
    });
    const row = response.rows?.[0];
    if (!row?.metricValues)
        throw new Error('No GA4 report rows returned');
    return {
        impressions: 0,
        clicks: 0,
        spend: 0,
        sessions: Number(row.metricValues[0]?.value ?? 0),
        bounceRate: Number(row.metricValues[1]?.value ?? 0),
        leads: Number(row.metricValues[2]?.value ?? 0),
        revenue: Number(row.metricValues[3]?.value ?? 0)
    };
}
