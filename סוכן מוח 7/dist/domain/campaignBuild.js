"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.campaignBuildInputSchema = exports.businessProfileSchema = void 0;
const zod_1 = require("zod");
exports.businessProfileSchema = zod_1.z.object({
    businessName: zod_1.z.string().min(2),
    category: zod_1.z.string().min(2),
    productType: zod_1.z.enum(['service', 'course', 'physical', 'subscription', 'other']),
    offer: zod_1.z.string().min(2),
    pricing: zod_1.z.object({
        currency: zod_1.z.string().min(3).max(3).default('USD'),
        amount: zod_1.z.number().nullable().default(null),
        model: zod_1.z.string().min(2)
    }),
    targetOutcome: zod_1.z.string().min(2),
    audienceHint: zod_1.z.string().optional(),
    currentAssets: zod_1.z.object({
        landingPageUrl: zod_1.z.string().url().optional(),
        websiteUrl: zod_1.z.string().url().optional(),
        socialUrls: zod_1.z.array(zod_1.z.string().url()).optional(),
        existingAds: zod_1.z.array(zod_1.z.string()).optional()
    }).default({}),
    constraints: zod_1.z.array(zod_1.z.string()).default([]),
    budget: zod_1.z.object({
        monthly: zod_1.z.number().nullable().default(null),
        testBudget: zod_1.z.number().nullable().default(null)
    }),
    goals: zod_1.z.object({
        primary: zod_1.z.enum(['leads', 'sales', 'appointments', 'awareness']),
        cpaTarget: zod_1.z.number().optional(),
        revenueTarget: zod_1.z.number().optional()
    }),
    historicalPerformance: zod_1.z.object({
        closeRate: zod_1.z.number().min(0).max(100).optional(),
        leadToCallRate: zod_1.z.number().min(0).max(100).optional(),
        currentCvR: zod_1.z.number().min(0).max(100).optional()
    }).optional()
});
exports.campaignBuildInputSchema = zod_1.z.object({
    business: exports.businessProfileSchema
});
