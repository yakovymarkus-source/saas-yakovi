import { CampaignBuildInput } from '../domain/campaignBuild';
import { runCampaignBuild } from '../agent/campaignOrchestrator';
import { runPerformanceAnalysis } from '../agent/optimization/performanceAnalyst';
import {
  buildCampaignStrategy,
  regenerateLandingPage,
  regenerateAds,
  regenerateVideoScripts,
  optimizeCampaign
} from '../services/campaignBuildService';
import { executeAnalysis } from '../services/analysisService';
import { AuthenticatedUser, AnalysisRequest } from '../types/domain';
import { PerformanceInput } from '../domain/optimization';

import {
  CampaignGoal,
  CampaignSession,
  AutomationLevel,
  SuperLayerResult,
  ApprovalDecision,
  NextAction
} from './types';

import {
  createSession,
  getSession,
  transition,
  trackResourceUsage
} from './stateManager';

import {
  saveShortTerm,
  getShortTerm,
  saveInsight,
  buildMemoryContext
} from './systemMemory';

import { decideNextAction } from './orchestrationDecisionEngine';

import {
  createApprovalCard,
  respondToApproval,
  hasPendingApproval,
  needsApprovalFor,
  formatApprovalCardForUser,
  getPendingApprovals
} from './approvalGate';

import { logActivity, getRecentActivity } from './activityLog';
import { HttpError } from '../utils/http';

// ── Public API ────────────────────────────────────────────────────────────────

export function startSession(
  userId: string,
  campaignId: string,
  goal: CampaignGoal,
  automationLevel: AutomationLevel = 'semi'
): CampaignSession {
  const session = createSession(userId, campaignId, goal, automationLevel);
  logActivity(session, 'state_change', `Session started. Goal: ${goal.type} → ${goal.target} ${goal.metric}`, {
    metadata: { automationLevel, goal }
  });
  return session;
}

export function getSessionById(sessionId: string): CampaignSession {
  const session = getSession(sessionId);
  if (!session) throw new HttpError(404, `Session ${sessionId} not found`);
  return session;
}

// ── Core tick — "what to do next" ────────────────────────────────────────────

export function tick(sessionId: string): SuperLayerResult {
  const session = getSessionById(sessionId);
  const nextAction = decideNextAction(session);

  logActivity(session, 'decision_made', `החלטה: ${nextAction.type} — ${nextAction.reason}`, {
    agent: nextAction.agent,
    metadata: { confidence: nextAction.confidence, priority: nextAction.priority }
  });

  // אם ההחלטה היא לבקש אישור ועוד לא ביקשנו — ניצור כרטיס
  if (nextAction.type === 'request_approval' && nextAction.approvalCard && !hasPendingApproval(session)) {
    const card = createApprovalCard(
      session,
      nextAction.approvalCard.agent,
      nextAction.approvalCard.problem,
      nextAction.approvalCard.solution,
      nextAction.approvalCard.why,
      nextAction.approvalCard.expectedImpact,
      nextAction.approvalCard.riskLevel
    );
    transition(session, 'awaiting_approval', 'approval card created');
    return buildResult(session, nextAction, `נוצר כרטיס אישור: ${card.id}`);
  }

  return buildResult(session, nextAction);
}

// ── Agent Runners ─────────────────────────────────────────────────────────────

export async function runResearchAgent(
  sessionId: string,
  buildInput: CampaignBuildInput,
  user: AuthenticatedUser
): Promise<SuperLayerResult> {
  const session = getSessionById(sessionId);

  if (!transition(session, 'researching', 'research agent started')) {
    throw new HttpError(400, `Cannot move to researching from state: ${session.state}`);
  }

  logActivity(session, 'agent_started', 'סוכן מחקר הופעל', { agent: 'research' });
  trackResourceUsage(session, 2);

  try {
    // We use the full build pipeline but only store the research portion
    const bundle = await runCampaignBuild(buildInput);
    saveShortTerm(session, 'marketResearch', bundle.market);
    saveShortTerm(session, 'audienceResearch', bundle.audience);
    saveShortTerm(session, 'businessProfile', bundle.business);
    saveShortTerm(session, 'businessCategory', bundle.business.category);

    // שמור תובנות זיכרון ארוך טווח
    const niche = bundle.business.category;
    for (const opp of bundle.market.whitespaceOpportunities ?? []) {
      saveInsight(session, niche, 'successful_angle', opp, 0.7);
    }
    for (const pattern of bundle.market.competitorPatterns ?? []) {
      saveInsight(session, niche, 'failed_approach', pattern, 0.65);
    }

    logActivity(session, 'agent_completed', 'מחקר הושלם — שוק וקהל מנותחים', {
      agent: 'research',
      result: `Market: ${bundle.market.marketStage}, Persona: ${bundle.audience.corePersona.label}`
    });

    transition(session, 'strategizing', 'research completed');
    return buildResult(session, decideNextAction(session), 'מחקר הושלם');
  } catch (error) {
    session.failureCount += 1;
    logActivity(session, 'agent_failed', `מחקר נכשל: ${error instanceof Error ? error.message : 'unknown'}`, { agent: 'research' });
    throw error;
  }
}

export async function runStrategyAgent(
  sessionId: string,
  campaignId: string,
  buildInput: CampaignBuildInput,
  user: AuthenticatedUser
): Promise<SuperLayerResult> {
  const session = getSessionById(sessionId);

  if (!transition(session, 'strategizing', 'strategy agent started')) {
    throw new HttpError(400, `Cannot move to strategizing from state: ${session.state}`);
  }

  logActivity(session, 'agent_started', 'סוכן אסטרטגיה הופעל', { agent: 'strategy' });
  trackResourceUsage(session, 3);

  try {
    const memoryContext = buildMemoryContext(session);
    const enrichedInput: CampaignBuildInput = memoryContext
      ? { ...buildInput, business: { ...buildInput.business, constraints: [...(buildInput.business.constraints ?? []), `זיכרון מערכת: ${memoryContext}`] } }
      : buildInput;

    const result = await buildCampaignStrategy(campaignId, enrichedInput, user);
    saveShortTerm(session, 'strategy', result);
    saveShortTerm(session, 'strategyVerdict', result.verdict);

    const niche = String(getShortTerm(session, 'businessCategory') ?? 'general');
    saveInsight(session, niche, 'successful_angle', result.verdict.angle, 0.75);

    logActivity(session, 'agent_completed', `אסטרטגיה הושלמה — זווית: ${result.verdict.angle}`, {
      agent: 'strategy',
      result: `Confidence: ${result.verdict.confidenceScore}%`
    });

    transition(session, 'executing', 'strategy completed');
    return buildResult(session, decideNextAction(session), 'אסטרטגיה הושלמה');
  } catch (error) {
    session.failureCount += 1;
    logActivity(session, 'agent_failed', `אסטרטגיה נכשלה: ${error instanceof Error ? error.message : 'unknown'}`, { agent: 'strategy' });
    throw error;
  }
}

export async function runExecutionAgent(
  sessionId: string,
  campaignId: string,
  buildInput: CampaignBuildInput,
  user: AuthenticatedUser,
  target?: 'landing' | 'ads' | 'video' | 'all'
): Promise<SuperLayerResult> {
  const session = getSessionById(sessionId);

  if (!transition(session, 'executing', 'execution agent started')) {
    throw new HttpError(400, `Cannot move to executing from state: ${session.state}`);
  }

  const execTarget = target ?? 'all';
  logActivity(session, 'agent_started', `סוכן ביצוע הופעל — target: ${execTarget}`, { agent: 'execution' });
  trackResourceUsage(session, 4);

  try {
    let result: Record<string, unknown>;

    if (execTarget === 'landing') {
      const r = await regenerateLandingPage(campaignId, buildInput, user);
      result = r as unknown as Record<string, unknown>;
    } else if (execTarget === 'ads') {
      const r = await regenerateAds(campaignId, buildInput, user);
      result = r as unknown as Record<string, unknown>;
    } else if (execTarget === 'video') {
      const r = await regenerateVideoScripts(campaignId, buildInput, user);
      result = r as unknown as Record<string, unknown>;
    } else {
      const r = await buildCampaignStrategy(campaignId, buildInput, user);
      result = r as unknown as Record<string, unknown>;
    }

    saveShortTerm(session, 'assets', result);
    saveShortTerm(session, 'qaResult', null);

    logActivity(session, 'agent_completed', `ביצוע הו��לם — ${execTarget}`, {
      agent: 'execution',
      result: `Target: ${execTarget}`
    });

    transition(session, 'qa_review', 'execution completed');
    return buildResult(session, decideNextAction(session), `ביצוע הושלם — ${execTarget}`);
  } catch (error) {
    session.failureCount += 1;
    logActivity(session, 'agent_failed', `ביצוע נכשל: ${error instanceof Error ? error.message : 'unknown'}`, { agent: 'execution' });
    throw error;
  }
}

export async function runQaAgent(
  sessionId: string,
  campaignId: string,
  buildInput: CampaignBuildInput,
  user: AuthenticatedUser
): Promise<SuperLayerResult> {
  const session = getSessionById(sessionId);

  if (!transition(session, 'qa_review', 'qa agent started')) {
    throw new HttpError(400, `Cannot move to qa_review from state: ${session.state}`);
  }

  logActivity(session, 'agent_started', 'סוכן QA הופעל', { agent: 'qa' });
  trackResourceUsage(session, 2);

  try {
    // QA is run via the build service which internally calls campaignRulesEngine
    const assets = getShortTerm<Record<string, unknown>>(session, 'assets');
    const strategy = getShortTerm<Record<string, unknown>>(session, 'strategy');

    if (!assets || !strategy) {
      throw new HttpError(400, 'אין תוצרים לבדיקת QA');
    }

    // Use the verdict from strategy as QA proxy
    const verdict = getShortTerm<Record<string, unknown>>(session, 'strategyVerdict');
    const passed = verdict?.status === 'approved';
    const reasons: string[] = passed ? [] : ['אסטרטגיה לא אושרה — ביטחון נמוך מדי'];

    const qaResult = { passed, reasons };
    saveShortTerm(session, 'qaResult', qaResult);

    logActivity(session, 'agent_completed', `QA: ${passed ? 'עבר ✅' : 'נכשל ❌'}`, {
      agent: 'qa',
      result: passed ? 'approved' : reasons.join(', ')
    });

    return buildResult(session, decideNextAction(session), `QA: ${passed ? 'עבר' : 'נכשל'}`);
  } catch (error) {
    session.failureCount += 1;
    logActivity(session, 'agent_failed', `QA נכשל: ${error instanceof Error ? error.message : 'unknown'}`, { agent: 'qa' });
    throw error;
  }
}

export async function runAnalysisAgentOnSession(
  sessionId: string,
  analysisInput: AnalysisRequest,
  user: AuthenticatedUser,
  requestId?: string
): Promise<SuperLayerResult> {
  const session = getSessionById(sessionId);

  logActivity(session, 'agent_started', 'סוכן ניתוח הופעל', { agent: 'analysis' });
  trackResourceUsage(session, 3);

  try {
    const result = await executeAnalysis(analysisInput, user, requestId);
    saveShortTerm(session, 'lastAnalysisResult', result.result);

    const verdict = result.result.verdict;
    const confidence = result.result.confidence;
    const narrative = result.result.narrative;

    // שמור תובנות לזיכרון ארוך טווח
    const niche = String(getShortTerm(session, 'businessCategory') ?? 'general');
    if (narrative) {
      saveInsight(session, niche, 'recurring_pain', narrative.bottleneck, confidence);
    }

    // קבע מה לשפר לפי ניתוח
    const improvementMap: Record<string, string> = {
      'Landing page issue': 'landing',
      'Creative failure': 'ads',
      'Audience mismatch': 'audience',
      'Budget inefficiency': 'strategy'
    };
    if (improvementMap[verdict]) {
      saveShortTerm(session, 'improvementTarget', improvementMap[verdict]);
    }

    logActivity(session, 'agent_completed', `ניתוח הושלם — verdict: ${verdict}`, {
      agent: 'analysis',
      result: `Confidence: ${(confidence * 100).toFixed(0)}%, Verdict: ${verdict}`
    });

    // בדוק auto-triggers
    const autoTriggers = result.result.autoTriggers ?? [];
    if (autoTriggers.length > 0) {
      logActivity(session, 'decision_made', `Auto-triggers: ${autoTriggers.map(t => t.action).join(', ')}`, {
        agent: 'analysis',
        metadata: { triggers: autoTriggers }
      });
    }

    const nextAction = decideNextAction(session);

    // אם ה-next action הוא request_approval ולא בכוח automatic — ניצור כרטיס
    if (nextAction.type === 'request_approval' && nextAction.approvalCard) {
      const needsApproval = needsApprovalFor(nextAction.approvalCard.riskLevel, session.automationLevel);
      if (needsApproval && !hasPendingApproval(session)) {
        createApprovalCard(
          session,
          nextAction.approvalCard.agent,
          nextAction.approvalCard.problem,
          nextAction.approvalCard.solution,
          nextAction.approvalCard.why,
          nextAction.approvalCard.expectedImpact,
          nextAction.approvalCard.riskLevel
        );
        transition(session, 'awaiting_approval', 'analysis requires approval');
      } else if (!needsApproval) {
        // auto mode — בצע ישירות
        transition(session, 'improving', 'auto mode — skipping approval for low risk');
      }
    }

    return buildResult(session, nextAction, `ניתוח: ${verdict}`);
  } catch (error) {
    session.failureCount += 1;
    logActivity(session, 'agent_failed', `ניתוח נכשל: ${error instanceof Error ? error.message : 'unknown'}`, { agent: 'analysis' });
    throw error;
  }
}

// ── Approval handling ─────────────────────────────────────────────────────────

export function handleApprovalResponse(
  sessionId: string,
  cardId: string,
  decision: ApprovalDecision,
  modifiedPlan?: string
): SuperLayerResult {
  const session = getSessionById(sessionId);
  const card = respondToApproval(session, cardId, decision, modifiedPlan);
  if (!card) throw new HttpError(404, `Approval card ${cardId} not found or already resolved`);

  if (decision === 'approve') {
    // מעבר בהתאם לסוג הכרטיס
    const nextStateMap: Record<string, CampaignSession['state']> = {
      'research':   'researching',
      'strategy':   'strategizing',
      'execution':  'executing',
      'qa':         'live',
      'analysis':   'improving'
    };
    const nextState = nextStateMap[card.agent];
    if (nextState) transition(session, nextState, `approved: ${card.solution}`);
  } else if (decision === 'modify' && modifiedPlan) {
    saveShortTerm(session, 'modifiedPlan', modifiedPlan);
    transition(session, 'improving', 'modified plan received');
  } else if (decision === 'reject') {
    transition(session, 'paused', 'user rejected proposed action');
  }

  return buildResult(session, decideNextAction(session), `אישור: ${decision}`);
}

// ── Proactive suggestions ─────────────────────────────────────────────────────

export function getProactiveSuggestions(sessionId: string): string[] {
  const session = getSessionById(sessionId);
  const suggestions: string[] = [];
  const analysis = getShortTerm<Record<string, unknown>>(session, 'lastAnalysisResult');

  if (!analysis) {
    suggestions.push('הפעל ניתוח — אין דאטה על ביצועי הקמפיין');
    return suggestions;
  }

  const confidence = (analysis.confidence as number) ?? 0;
  const roas = (analysis.metrics as Record<string, number>)?.roas;
  const autoTriggers = (analysis.autoTriggers as Array<Record<string, unknown>>) ?? [];

  if (confidence > 0.85 && roas && roas > 4) {
    suggestions.push(`ROAS ${roas.toFixed(1)}x — כדאי לשקול סקייל של תקציב ב-50%`);
  }
  if (autoTriggers.length > 0) {
    for (const trigger of autoTriggers) {
      suggestions.push(`⚠️ ${trigger['action']}`);
    }
  }
  if (session.iterationCount > 10 && session.failureCount === 0) {
    suggestions.push('הקמפיין רץ טוב — האם לשקול בדיקת זוויות חדשות?');
  }

  logActivity(session, 'proactive_suggestion', `${suggestions.length} הצעות פרואקטיביות`, {
    metadata: { suggestions }
  });

  return suggestions;
}

// ── Helper ────────────────────────────────────────────────────────────────────

function buildResult(session: CampaignSession, nextAction: NextAction, summary?: string): SuperLayerResult {
  const pendingCards = getPendingApprovals(session);
  return {
    sessionId: session.id,
    state: session.state,
    nextAction,
    pendingApprovals: pendingCards,
    recentActivity: getRecentActivity(session, 8),
    summary: summary ?? nextAction.reason
  };
}
