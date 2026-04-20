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

// ── Goal Hierarchy ────────────────────────────────────────────────────────────
export type GoalStatus = 'on_track' | 'at_risk' | 'off_track';

export interface GoalLevel {
  name: string;
  metric: string;
  value: number | null;
  target: number | null;
  status: GoalStatus;
}

export interface GoalHierarchy {
  primary: GoalLevel;
  secondary: GoalLevel[];
  operational: GoalLevel[];
}

// ── Tradeoffs ─────────────────────────────────────────────────────────────────
export interface Tradeoff {
  metricA: string;
  metricB: string;
  observation: string;
  recommendation: string;
}

// ── Narrative ─────────────────────────────────────────────────────────────────
export interface NarrativeOutput {
  headline: string;
  story: string;
  bottleneck: string;
  action: string;
}

// ── Pattern Library ───────────────────────────────────────────────────────────
export interface KnownPattern {
  id: string;
  name: string;
  diagnosis: string;
  solution: string;
  confidence: number;
}

export interface PatternMatch {
  pattern: KnownPattern;
  matchScore: number;
}

// ── Confidence Routing ────────────────────────────────────────────────────────
export type ConfidenceRecommendation = 'act_now' | 'test_first' | 'gather_more_data';

export interface ConfidenceRoute {
  confidence: number;
  recommendation: ConfidenceRecommendation;
  rationale: string;
}

// ── Advanced Priority ─────────────────────────────────────────────────────────
export interface PriorityDirective {
  order: number;
  action: string;
  reason: string;
  blockedBy?: string;
}

// ── Execution Sync ────────────────────────────────────────────────────────────
export type ExecutionStatus = 'pending' | 'executed' | 'skipped';

export interface ExecutionSyncItem {
  actionCode: string;
  title: string;
  status: ExecutionStatus;
  executedAt?: string;
}

// ── Auto-Trigger ──────────────────────────────────────────────────────────────
export type TriggerSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface AutoTriggerRule {
  id: string;
  condition: string;
  triggered: boolean;
  action: string;
  severity: TriggerSeverity;
}

// ── Query Engine ──────────────────────────────────────────────────────────────
export interface QueryResponse {
  query: string;
  answer: string;
  relatedIssues: string[];
  confidence: number;
}

export interface EngineResult {
  verdict: VerdictType;
  confidence: number;
  metrics: ComputedMetrics;
  normalizedMetrics: NormalizedMetrics;
  issues: Issue[];
  prioritizedActions: Action[];
  decisionLog: Record<string, unknown>;
  // Gap completions (all optional for backward compat)
  goals?: GoalHierarchy;
  tradeoffs?: Tradeoff[];
  narrative?: NarrativeOutput;
  patternMatches?: PatternMatch[];
  confidenceRoute?: ConfidenceRoute;
  priorityDirectives?: PriorityDirective[];
  executionSync?: ExecutionSyncItem[];
  autoTriggers?: AutoTriggerRule[];
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
