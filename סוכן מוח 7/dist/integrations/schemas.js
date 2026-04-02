"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analysisRequestSchema = exports.campaignPayloadSchema = exports.rawMetricsSchema = void 0;
const zod_1 = require("zod");
exports.rawMetricsSchema = zod_1.z.object({
    impressions: zod_1.z.number().nonnegative(),
    clicks: zod_1.z.number().nonnegative(),
    spend: zod_1.z.number().nonnegative(),
    landingPageViews: zod_1.z.number().nonnegative().optional().nullable(),
    sessions: zod_1.z.number().nonnegative().optional().nullable(),
    leads: zod_1.z.number().nonnegative().optional().nullable(),
    purchases: zod_1.z.number().nonnegative().optional().nullable(),
    revenue: zod_1.z.number().nonnegative().optional().nullable(),
    frequency: zod_1.z.number().nonnegative().optional().nullable(),
    bounceRate: zod_1.z.number().min(0).max(1).optional().nullable(),
    addToCart: zod_1.z.number().nonnegative().optional().nullable(),
    initiatedCheckout: zod_1.z.number().nonnegative().optional().nullable()
});
exports.campaignPayloadSchema = zod_1.z.object({
    name: zod_1.z.string().min(1),
    objective: zod_1.z.custom((value) => ['lead_generation', 'sales', 'traffic', 'awareness'].includes(String(value))),
    currency: zod_1.z.string().min(3).max(3),
    manualMetrics: exports.rawMetricsSchema.optional()
});
exports.analysisRequestSchema = zod_1.z.object({
    source: zod_1.z.custom((value) => ['meta', 'googleAds', 'ga4'].includes(String(value))),
    externalCampaignId: zod_1.z.string().min(1).optional(),
    campaign: exports.campaignPayloadSchema
});
