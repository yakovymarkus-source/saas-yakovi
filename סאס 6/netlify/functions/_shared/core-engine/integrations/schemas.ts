import { z } from 'zod';
import { CampaignObjective } from '../types/domain';

export const rawMetricsSchema = z.object({
  impressions: z.number().nonnegative(),
  clicks: z.number().nonnegative(),
  spend: z.number().nonnegative(),
  landingPageViews: z.number().nonnegative().optional().nullable(),
  sessions: z.number().nonnegative().optional().nullable(),
  leads: z.number().nonnegative().optional().nullable(),
  purchases: z.number().nonnegative().optional().nullable(),
  revenue: z.number().nonnegative().optional().nullable(),
  frequency: z.number().nonnegative().optional().nullable(),
  bounceRate: z.number().min(0).max(1).optional().nullable(),
  addToCart: z.number().nonnegative().optional().nullable(),
  initiatedCheckout: z.number().nonnegative().optional().nullable()
});

export const campaignPayloadSchema = z.object({
  name: z.string().min(1),
  objective: z.custom<CampaignObjective>((value) => ['lead_generation', 'sales', 'traffic', 'awareness'].includes(String(value))),
  currency: z.string().min(3).max(3),
  manualMetrics: rawMetricsSchema.optional()
});

export const analysisRequestSchema = z.object({
  source: z.custom<'meta' | 'googleAds' | 'ga4'>((value) => ['meta', 'googleAds', 'ga4'].includes(String(value))),
  externalCampaignId: z.string().min(1).optional(),
  campaign: campaignPayloadSchema
});
