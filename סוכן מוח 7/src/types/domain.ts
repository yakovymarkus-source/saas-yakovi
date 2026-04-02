export type SourcePlatform = 'meta' | 'googleAds' | 'ga4';
export type CampaignObjective = 'lead_generation' | 'sales' | 'traffic' | 'awareness';
export type VerdictType = 'Creative failure' | 'Audience mismatch' | 'Landing page issue' | 'Budget inefficiency';
export type AnalysisStage = 'creative' | 'audience' | 'landing_page' | 'budget';
export type EngineVersion = string;

export interface UserRecord {
  id: string;
  email: string;
  created_at: string;
  updated_at: string;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  roles: string[];
  permissions?: string[];
  token: string;
  supabaseUserId: string;
}

export interface CampaignRecord {
  id: string;
  user_id: string;
  external_id: string | null;
  name: string;
  source: SourcePlatform;
  objective: CampaignObjective | null;
  currency: string;
  payload: unknown;
  created_at: string;
  updated_at: string;
}

export interface RawMetrics {
  impressions: number;
  clicks: number;
  spend: number;
  landingPageViews?: number | null;
  sessions?: number | null;
  leads?: number | null;
  purchases?: number | null;
  revenue?: number | null;
  frequency?: number | null;
  bounceRate?: number | null;
  addToCart?: number | null;
  initiatedCheckout?: number | null;
}

export interface CampaignPayload {
  name: string;
  objective: CampaignObjective;
  currency: string;
  manualMetrics?: RawMetrics;
}

export interface AnalysisRequest {
  source: SourcePlatform;
  externalCampaignId?: string;
  campaign: CampaignPayload;
}

export interface NormalizedMetrics {
  impressions: number;
  clicks: number;
  spend: number;
  landingPageViews: number;
  sessions: number;
  leads: number;
  purchases: number;
  revenue: number;
  frequency: number;
  bounceRate: number;
  addToCart: number;
  initiatedCheckout: number;
}

export interface ComputedMetrics {
  ctr: number;
  cpc: number;
  cpa: number | null;
  conversionRate: number;
  landingPageDropoffRate: number;
  sessionDropoffRate: number;
  checkoutDropoffRate: number;
  roas: number | null;
}

export interface Issue {
  code: string;
  verdictType: VerdictType;
  severity: number;
  confidence: number;
  stage: AnalysisStage;
  reason: string;
  evidence: string[];
}

export interface Action {
  code: string;
  title: string;
  why: string;
  expectedImpact: string;
  impact: number;
  effort: number;
  urgency: number;
  priorityScore: number;
}

export interface EngineResult {
  verdict: VerdictType;
  confidence: number;
  metrics: ComputedMetrics;
  normalizedMetrics: NormalizedMetrics;
  issues: Issue[];
  prioritizedActions: Action[];
  decisionLog: Record<string, unknown>;
}

export interface ExportedAnalysisPayload {
  format: 'json';
  fileName: string;
  contentType: 'application/json';
  data: string;
}

export interface AnalysisResult {
  analysisId: string;
  campaignId: string;
  userId: string;
  source: SourcePlatform;
  engineVersion: EngineVersion;
  cached: boolean;
  createdAt: string;
  result: EngineResult;
  exported?: ExportedAnalysisPayload | null;
}

export interface CacheRecord<T> {
  key: string;
  value: T;
  inputHash: string;
  engineVersion: EngineVersion;
  createdAt: string;
  expiresAt: number;
}
