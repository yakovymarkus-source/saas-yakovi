import crypto from 'crypto';
import { ActivityEntry, ActivityType, AgentName, CampaignSession } from './types';

export function logActivity(
  session: CampaignSession,
  type: ActivityType,
  action: string,
  options: {
    agent?: AgentName;
    result?: string;
    approvedBy?: string;
    metadata?: Record<string, unknown>;
  } = {}
): ActivityEntry {
  const entry: ActivityEntry = {
    id: crypto.randomUUID(),
    sessionId: session.id,
    timestamp: new Date().toISOString(),
    type,
    action,
    ...options
  };
  session.activityLog.push(entry);
  session.updatedAt = entry.timestamp;
  return entry;
}

export function getRecentActivity(session: CampaignSession, limit = 10): ActivityEntry[] {
  return session.activityLog.slice(-limit);
}

export function getActivityByType(session: CampaignSession, type: ActivityType): ActivityEntry[] {
  return session.activityLog.filter(e => e.type === type);
}

export function countAgentCalls(session: CampaignSession, agent: AgentName): number {
  return session.activityLog.filter(e => e.agent === agent && e.type === 'agent_completed').length;
}

export function getLastAgentRun(session: CampaignSession, agent: AgentName): ActivityEntry | undefined {
  return [...session.activityLog]
    .reverse()
    .find(e => e.agent === agent && (e.type === 'agent_completed' || e.type === 'agent_failed'));
}
