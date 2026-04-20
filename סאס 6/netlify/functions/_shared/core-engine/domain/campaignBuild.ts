import { z } from 'zod';

export const businessProfileSchema = z.object({
  businessName: z.string().min(2),
  category: z.string().min(2),
  productType: z.enum(['service', 'course', 'physical', 'subscription', 'other']),
  offer: z.string().min(2),
  pricing: z.object({
    currency: z.string().min(3).max(3).default('USD'),
    amount: z.number().nullable().default(null),
    model: z.string().min(2)
  }),
  targetOutcome: z.string().min(2),
  audienceHint: z.string().optional(),
  currentAssets: z.object({
    landingPageUrl: z.string().url().optional(),
    websiteUrl: z.string().url().optional(),
    socialUrls: z.array(z.string().url()).optional(),
    existingAds: z.array(z.string()).optional()
  }).default({}),
  constraints: z.array(z.string()).default([]),
  budget: z.object({
    monthly: z.number().nullable().default(null),
    testBudget: z.number().nullable().default(null)
  }),
  goals: z.object({
    primary: z.enum(['leads', 'sales', 'appointments', 'awareness']),
    cpaTarget: z.number().optional(),
    revenueTarget: z.number().optional()
  }),
  historicalPerformance: z.object({
    closeRate: z.number().min(0).max(100).optional(),
    leadToCallRate: z.number().min(0).max(100).optional(),
    currentCvR: z.number().min(0).max(100).optional()
  }).optional()
});

export type BusinessProfile = z.infer<typeof businessProfileSchema>;

export const campaignBuildInputSchema = z.object({
  business: businessProfileSchema
});

export type CampaignBuildInput = z.infer<typeof campaignBuildInputSchema>;

export interface MarketResearch {
  marketStage: 'red_ocean' | 'growing' | 'educational' | 'mature';
  competitorPatterns: string[];
  commonOffers: string[];
  saturatedClaims: string[];
  whitespaceOpportunities: string[];
  pricingBands: { low?: number; mid?: number; high?: number };
  marketRisks: string[];
}

export interface AudienceResearch {
  corePersona: {
    label: string;
    pains: string[];
    desires: string[];
    fears: string[];
    objections: string[];
    triggers: string[];
    languagePatterns: string[];
    surfacePains?: string[];
    deepPains?: string[];
    objectionsByStage?: {
      awareness: string[];
      consideration: string[];
      conversion: string[];
    };
    behavioralSignals?: string[];
  };
  awarenessLevel: 'unaware' | 'problem_aware' | 'solution_aware' | 'product_aware' | 'most_aware';
  emotionalDrivers: string[];
  buyingBarriers: string[];
}

export interface PositioningDecision {
  categoryFrame: string;
  uniqueMechanism: string;
  enemy: string;
  promise: string;
  proofStrategy: string;
  tone: 'authoritative' | 'empathetic' | 'direct' | 'premium' | 'rebellious';
  coreAngle: string;
  messagingHierarchy: string[];
}

export interface OfferStrategy {
  offerType: 'lead_magnet' | 'tripwire' | 'core_offer' | 'call_booking' | 'application';
  pricingStrategy: string;
  bonuses: string[];
  guarantee?: string;
  urgencyMechanism?: string;
  ctaType: 'buy_now' | 'book_call' | 'leave_details' | 'apply_now';
  offerStructure: string[];
  trustLevel?: 'low' | 'medium' | 'high';
  valueStack?: string[];
  weakPoints?: string[];
}

export interface FunnelPlan {
  topOfFunnel: string[];
  middleOfFunnel: string[];
  bottomOfFunnel: string[];
  steps: Array<{
    step: string;
    objective: string;
    asset: string;
    message: string;
    cta: string;
  }>;
  followUpSequence: Array<{
    day: number;
    channel: 'email' | 'whatsapp' | 'sms';
    objective: string;
    messageAngle: string;
  }>;
}

export interface CampaignBuildOutput {
  business: BusinessProfile;
  market: MarketResearch;
  audience: AudienceResearch;
  positioning: PositioningDecision;
  offer: OfferStrategy;
  funnel: FunnelPlan;
}
