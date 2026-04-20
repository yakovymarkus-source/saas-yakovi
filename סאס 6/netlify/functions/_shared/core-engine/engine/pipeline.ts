import crypto from 'crypto';
import { resolveMetrics } from '../integrations/metricsProvider';
import { normalizeMetrics } from './normalize';
import { computeMetrics } from './metrics';
import { runDecisionEngine } from './decisionEngine';
import { buildGoalHierarchy } from './goalHierarchy';
import { detectTradeoffs } from './tradeoffEngine';
import { buildNarrative } from './narrativeEngine';
import { matchPatterns, enrichPatternsWithMemory } from './patternLibrary';
import { calibrateConfidence } from './confidenceCalibration';
import { buildPriorityDirectives } from './priorityEngine';
import { initExecutionSync } from './executionSync';
import { evaluateAutoTriggers } from './autoTrigger';
import { recordMemory } from './learningMemory';
import { AnalysisRequest, AuthenticatedUser, EngineResult } from '../types/domain';
import { stableStringify } from '../utils/stableStringify';
import { HttpError } from '../utils/http';
import { logEvent } from '../utils/logger';

export interface AnalysisExecutionContext {
  requestId?: string;
  userId?: string;
  campaignId?: string;
  analysisId?: string;
}

export function createAnalysisInputHash(input: AnalysisRequest): string {
  return crypto.createHash('sha256').update(stableStringify(input)).digest('hex');
}

function assertAnalysisInput(input: AnalysisRequest): void {
  if (!input || typeof input !== 'object') {
    throw new HttpError(400, 'Analysis input must be an object');
  }

  if (!input.source || !['meta', 'googleAds', 'ga4'].includes(input.source)) {
    throw new HttpError(400, 'Analysis source is invalid');
  }

  if (!input.campaign || typeof input.campaign !== 'object') {
    throw new HttpError(400, 'Analysis input is missing campaign payload');
  }

  if (!input.campaign.name?.trim()) {
    throw new HttpError(400, 'Campaign name is required');
  }

  if (!input.campaign.objective) {
    throw new HttpError(400, 'Campaign objective is required');
  }

  if (!input.campaign.currency || input.campaign.currency.trim().length !== 3) {
    throw new HttpError(400, 'Campaign currency must be a 3-letter ISO code');
  }

  if (stableStringify(input).length > 256_000) {
    throw new HttpError(413, 'Analysis input is too large');
  }
}

export async function runAnalysis(
  input: AnalysisRequest,
  _user: AuthenticatedUser,
  context: AnalysisExecutionContext = {}
): Promise<EngineResult> {
  assertAnalysisInput(input);

  await logEvent({
    level: 'info',
    type: 'analysis_pipeline_started',
    message: 'Analysis pipeline started',
    requestId: context.requestId,
    userId: context.userId,
    campaignId: context.campaignId,
    analysisId: context.analysisId,
    meta: { source: input.source }
  });

  try {
    const metrics = await resolveMetrics(input);
    const normalized = normalizeMetrics(metrics);
    const computed = computeMetrics(normalized);
    const base = runDecisionEngine(input.campaign, normalized, computed);

    // Enrich with all gap engines
    const goals = buildGoalHierarchy(input.campaign.objective, computed, normalized);
    const tradeoffs = detectTradeoffs(computed, normalized);
    const narrative = buildNarrative(base);
    const rawPatterns = matchPatterns(computed, normalized);
    const patternMatches = context.userId ? enrichPatternsWithMemory(rawPatterns, context.userId) : rawPatterns;
    const confidenceRoute = calibrateConfidence(base.confidence, base.issues);
    const priorityDirectives = buildPriorityDirectives(base.prioritizedActions, base.verdict);
    const executionSync = initExecutionSync(context.analysisId ?? 'temp', base.prioritizedActions);
    const autoTriggers = evaluateAutoTriggers(computed, normalized);

    if (context.userId && context.campaignId) {
      recordMemory({
        campaignId: context.campaignId,
        userId: context.userId,
        verdict: base.verdict,
        confidence: base.confidence,
        topIssueCode: base.issues[0]?.code ?? 'none',
        patternIds: rawPatterns.map(m => m.pattern.id),
        timestamp: new Date().toISOString()
      });
    }

    const result: EngineResult = {
      ...base,
      goals,
      tradeoffs,
      narrative,
      patternMatches,
      confidenceRoute,
      priorityDirectives,
      executionSync,
      autoTriggers
    };

    await logEvent({
      level: 'info',
      type: 'analysis_pipeline_completed',
      message: 'Analysis pipeline completed',
      requestId: context.requestId,
      userId: context.userId,
      campaignId: context.campaignId,
      analysisId: context.analysisId,
      meta: {
        source: input.source,
        verdict: result.verdict,
        confidence: result.confidence,
        engineVersion: result.decisionLog.engineVersion,
        autoTriggersCount: autoTriggers.length,
        patternMatchesCount: patternMatches.length
      }
    });

    return result;
  } catch (error) {
    await logEvent({
      level: 'error',
      type: 'analysis_pipeline_failed',
      message: error instanceof Error ? error.message : 'Analysis pipeline failed',
      requestId: context.requestId,
      userId: context.userId,
      campaignId: context.campaignId,
      analysisId: context.analysisId,
      meta: {
        source: input.source,
        errorName: error instanceof Error ? error.name : 'UnknownError'
      }
    }).catch(() => undefined);

    if (error instanceof HttpError) {
      throw error;
    }

    const message = error instanceof Error ? error.message : 'Analysis pipeline failed';
    throw new HttpError(500, 'Analysis pipeline failed', { cause: message });
  }
}
