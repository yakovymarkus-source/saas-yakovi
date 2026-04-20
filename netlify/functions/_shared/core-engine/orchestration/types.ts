// ── Campaign States ───────────────────────────────────────────────────────────
export type CampaignState =
  | 'idle'
  | 'researching'
  | 'strategizing'
  | 'executing'
  | 'qa_review'
  | 'awaiting_approval'
  | 'live'
  | 'monitoring'
  | 'analyzing'
  | 'improving'
  | 'paused'
  | 'failed';

// ── Agents ────────────────────────────────────────────────────────────────────
export type AgentName = 'research' | 'strategy' | 'execution' | 'qa' | 'analysis';

// ── Automation ────────────────────────────────────────────────────────────────
export type AutomationLevel = 'manual' | 'semi' | 'auto';
export type LoopType = 'fast' | 'deep';

// ── Goal ──────────────────────────────────────────────────────────────────────
export type GoalType = 'leads' | 'sales' | 'followers' | 'conversion_improvement';

export interface CampaignGoal {
  type: GoalType;
  target: number;
  timeframe: string;
  metric: string;
  currentValue?: number;
}

// ── Approval ──────────────────────────────────────────────────────────────────
export type ApprovalDecision = 'approve' | 'modify' | 'reject';
export type ApprovalStatus = 'pending' | 'approved' | 'modified' | 'rejected';
export type RiskLevel = 'low' | 'medium' | 'high';

export interface ApprovalCard {
  id: string;
  sessionId: string;
  problem: string;
  solution: string;
  why: string;
  expectedImpact: string;
  riskLevel: RiskLevel;
  agent: AgentName;
  createdAt: string;
  status: ApprovalStatus;
  userResponse?: {
    decision: ApprovalDecision;
    modifiedPlan?: string;
    respondedAt: string;
  };
}

// ── Activity Log ──────────────────────────────────────────────────────────────
export type ActivityType =
  | 'state_change'
  | 'agent_started'
  | 'agent_completed'
  | 'agent_failed'
  | 'approval_requested'
  | 'approval_received'
  | 'loop_started'
  | 'loop_completed'
  | 'decision_made'
  | 'memory_saved'
  | 'resource_alert'
  | 'system_stop'
  | 'proactive_suggestion';

export interface ActivityEntry {
  id: string;
  sessionId: string;
  timestamp: string;
  type: ActivityType;
  agent?: AgentName;
  action: string;
  result?: string;
  approvedBy?: string;
  metadata?: Record<string, unknown>;
}

// ── Next Action Decision ──────────────────────────────────────────────────────
export type NextActionType =
  | 'run_agent'
  | 'request_approval'
  | 'start_loop'
  | 'stop'
  | 'wait'
  | 'proactive_suggestion';

export interface NextAction {
  type: NextActionType;
  agent?: AgentName;
  loopType?: LoopType;
  approvalCard?: Omit<ApprovalCard, 'id' | 'sessionId' | 'createdAt' | 'status'>;
  reason: string;
  confidence: number;
  priority: 'critical' | 'high' | 'medium' | 'low';
}

// ── Long-Term Memory ──────────────────────────────────────────────────────────
export interface LongTermInsight {
  niche: string;
  type: 'successful_angle' | 'failed_approach' | 'recurring_pain' | 'winning_hook';
  content: string;
  occurrences: number;
  lastSeen: string;
  confidence: number;
}

export interface SystemMemoryState {
  shortTerm: Record<string, unknown>;
  longTerm: LongTermInsight[];
  lastUpdated: string;
}

// ── Session ───────────────────────────────────────────────────────────────────
export interface CampaignSession {
  id: string;
  userId: string;
  campaignId: string;
  goal: CampaignGoal;
  state: CampaignState;
  automationLevel: AutomationLevel;
  iterationCount: number;
  failureCount: number;
  pendingApprovals: ApprovalCard[];
  activityLog: ActivityEntry[];
  memory: SystemMemoryState;
  versions: SessionVersion[];
  resourceUsage: ResourceUsage;
  createdAt: string;
  updatedAt: string;
}

// ── Versioning ────────────────────────────────────────────────────────────────
export interface SessionVersion {
  version: number;
  state: CampaignState;
  snapshotAt: string;
  reason: string;
  canRollback: boolean;
}

// ── Resource Usage ────────────────────────────────────────────────────────────
export interface ResourceUsage {
  agentCallsTotal: number;
  agentCallsThisSession: number;
  estimatedCostUnits: number;
  lastResetAt: string;
}

// ── Super Layer Result ────────────────────────────────────────────────────────
export interface SuperLayerResult {
  sessionId: string;
  state: CampaignState;
  nextAction: NextAction;
  pendingApprovals: ApprovalCard[];
  recentActivity: ActivityEntry[];
  summary: string;
}
