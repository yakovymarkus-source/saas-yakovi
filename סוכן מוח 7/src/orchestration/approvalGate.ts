import crypto from 'crypto';
import { ApprovalCard, ApprovalDecision, CampaignSession, RiskLevel, AgentName } from './types';
import { logActivity } from './activityLog';

export function createApprovalCard(
  session: CampaignSession,
  agent: AgentName,
  problem: string,
  solution: string,
  why: string,
  expectedImpact: string,
  riskLevel: RiskLevel
): ApprovalCard {
  const card: ApprovalCard = {
    id: crypto.randomUUID(),
    sessionId: session.id,
    agent,
    problem,
    solution,
    why,
    expectedImpact,
    riskLevel,
    createdAt: new Date().toISOString(),
    status: 'pending'
  };
  session.pendingApprovals.push(card);
  logActivity(session, 'approval_requested', `אישור נדרש: ${problem}`, {
    agent,
    metadata: { cardId: card.id, riskLevel, solution }
  });
  return card;
}

export function getPendingApprovals(session: CampaignSession): ApprovalCard[] {
  return session.pendingApprovals.filter(c => c.status === 'pending');
}

export function respondToApproval(
  session: CampaignSession,
  cardId: string,
  decision: ApprovalDecision,
  modifiedPlan?: string
): ApprovalCard | null {
  const card = session.pendingApprovals.find(c => c.id === cardId);
  if (!card || card.status !== 'pending') return null;

  card.status = decision === 'modify' ? 'modified' : decision === 'approve' ? 'approved' : 'rejected';
  card.userResponse = {
    decision,
    modifiedPlan,
    respondedAt: new Date().toISOString()
  };

  logActivity(session, 'approval_received', `תגובת משתמש: ${decision} — ${card.problem.slice(0, 60)}`, {
    approvedBy: session.userId,
    metadata: { cardId, decision, modifiedPlan }
  });

  return card;
}

export function hasPendingApproval(session: CampaignSession): boolean {
  return session.pendingApprovals.some(c => c.status === 'pending');
}

export function needsApprovalFor(riskLevel: RiskLevel, automationLevel: CampaignSession['automationLevel']): boolean {
  if (automationLevel === 'manual') return true;
  if (automationLevel === 'semi') return riskLevel === 'medium' || riskLevel === 'high';
  // auto: only high risk needs approval
  return riskLevel === 'high';
}

export function formatApprovalCardForUser(card: ApprovalCard): Record<string, string> {
  return {
    id: card.id,
    '🔴 הבעיה': card.problem,
    '✅ הפתרון המוצע': card.solution,
    '🧠 למה': card.why,
    '📈 ההשפעה הצפויה': card.expectedImpact,
    '⚠️ רמת סיכון': card.riskLevel,
    '🤖 הסוכן': card.agent,
    'פעולות אפשריות': 'approve / modify / reject'
  };
}
