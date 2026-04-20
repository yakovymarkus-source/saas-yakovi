import crypto from 'crypto';
import { CampaignSession, CampaignState, SessionVersion } from './types';
import { logActivity } from './activityLog';

// ── Valid transitions ────────────────────────────────────────────���────────────
const TRANSITIONS: Record<CampaignState, CampaignState[]> = {
  idle:               ['researching', 'paused'],
  researching:        ['strategizing', 'idle', 'failed'],
  strategizing:       ['executing', 'researching', 'failed'],
  executing:          ['qa_review', 'strategizing', 'failed'],
  qa_review:          ['awaiting_approval', 'executing', 'failed'],
  awaiting_approval:  ['executing', 'live', 'improving', 'paused', 'failed'],
  live:               ['monitoring', 'paused', 'failed'],
  monitoring:         ['analyzing', 'live', 'paused'],
  analyzing:          ['improving', 'monitoring', 'awaiting_approval', 'failed'],
  improving:          ['executing', 'strategizing', 'researching', 'awaiting_approval', 'monitoring'],
  paused:             ['idle', 'monitoring', 'improving'],
  failed:             ['idle']
};

// ── In-memory session store (swap for DB in production) ───────────────────────
const sessions: Map<string, CampaignSession> = new Map();

export function createSession(
  userId: string,
  campaignId: string,
  goal: CampaignSession['goal'],
  automationLevel: CampaignSession['automationLevel'] = 'semi'
): CampaignSession {
  const now = new Date().toISOString();
  const session: CampaignSession = {
    id: crypto.randomUUID(),
    userId,
    campaignId,
    goal,
    state: 'idle',
    automationLevel,
    iterationCount: 0,
    failureCount: 0,
    pendingApprovals: [],
    activityLog: [],
    memory: { shortTerm: {}, longTerm: [], lastUpdated: now },
    versions: [],
    resourceUsage: {
      agentCallsTotal: 0,
      agentCallsThisSession: 0,
      estimatedCostUnits: 0,
      lastResetAt: now
    },
    createdAt: now,
    updatedAt: now
  };
  sessions.set(session.id, session);
  return session;
}

export function getSession(sessionId: string): CampaignSession | undefined {
  return sessions.get(sessionId);
}

export function transition(session: CampaignSession, to: CampaignState, reason: string): boolean {
  const allowed = TRANSITIONS[session.state];
  if (!allowed.includes(to)) return false;

  snapshotVersion(session, reason);

  const from = session.state;
  session.state = to;
  session.iterationCount += 1;

  logActivity(session, 'state_change', `${from} → ${to}`, { metadata: { reason } });
  return true;
}

export function forceTransition(session: CampaignSession, to: CampaignState, reason: string): void {
  snapshotVersion(session, reason);
  const from = session.state;
  session.state = to;
  logActivity(session, 'state_change', `[FORCE] ${from} → ${to}`, { metadata: { reason } });
}

function snapshotVersion(session: CampaignSession, reason: string): void {
  const version: SessionVersion = {
    version: session.versions.length + 1,
    state: session.state,
    snapshotAt: new Date().toISOString(),
    reason,
    canRollback: true
  };
  session.versions.push(version);
  // Keep last 20 snapshots
  if (session.versions.length > 20) session.versions.shift();
}

export function rollback(session: CampaignSession): boolean {
  const rollbackable = [...session.versions].reverse().find(v => v.canRollback && v.state !== session.state);
  if (!rollbackable) return false;
  session.state = rollbackable.state;
  logActivity(session, 'state_change', `rollback → ${rollbackable.state}`, {
    metadata: { rolledBackTo: rollbackable.version, reason: rollbackable.reason }
  });
  return true;
}

export function trackResourceUsage(session: CampaignSession, costUnits = 1): void {
  session.resourceUsage.agentCallsTotal += 1;
  session.resourceUsage.agentCallsThisSession += 1;
  session.resourceUsage.estimatedCostUnits += costUnits;
}
