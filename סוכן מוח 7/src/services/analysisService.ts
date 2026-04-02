import crypto from 'crypto';
import { upsertCampaign } from '../db/campaignsRepository';
import { saveAnalysisResult } from '../db/analysisRepository';
import { logEvent, writeOperationalLog } from '../utils/logger';
import { TtlCache } from '../utils/cache';
import { env } from '../config/env';
import { AnalysisRequest, AnalysisResult, AuthenticatedUser } from '../types/domain';
import { buildVersionedKey, ENGINE_VERSION } from '../engine/versioning';
import { createAnalysisInputHash, runAnalysis } from '../engine/pipeline';
import { requirePermission } from '../auth/permissions';
import { featureFlags } from '../config/featureFlags';
import { exportAnalysisResult } from '../output/exporter';
import { stableStringify } from '../utils/stableStringify';
import { HttpError } from '../utils/http';
import { withTransaction } from '../db/client';

export const analysisResultCache = new TtlCache<AnalysisResult>(env.CACHE_TTL_SECONDS, ENGINE_VERSION);

function hashAnalysisInput(input: AnalysisRequest, userId: string): string {
  return crypto.createHash('sha256').update(`${userId}:${stableStringify(input)}`).digest('hex');
}

function isValidAnalysisResult(value: unknown): value is AnalysisResult {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.analysisId === 'string' && typeof record.campaignId === 'string' && typeof record.userId === 'string' && typeof record.engineVersion === 'string' && !!record.result;
}

export async function executeAnalysis(input: AnalysisRequest, user: AuthenticatedUser, requestId?: string): Promise<AnalysisResult> {
  requirePermission(user, 'analysis:run');

  if (!input?.campaign) {
    throw new HttpError(400, 'Analysis input is missing campaign payload');
  }

  let campaignId: string | undefined;
  let analysisId: string | undefined;

  try {
    const inputHash = hashAnalysisInput(input, user.id);
    const cacheKey = buildVersionedKey(inputHash);

    await logEvent({
      level: 'info',
      type: 'analysis_started',
      message: 'Analysis execution started',
      requestId,
      userId: user.id,
      meta: { source: input.source, inputHash, engineVersion: ENGINE_VERSION }
    });

    if (featureFlags.enableAnalysisCache) {
      const cached = analysisResultCache.get(cacheKey);
      if (cached && isValidAnalysisResult(cached)) {
        await logEvent({
          level: 'info',
          type: 'analysis_cache_hit',
          message: `Analysis served from cache for campaign ${cached.campaignId}`,
          requestId,
          userId: user.id,
          campaignId: cached.campaignId,
          analysisId: cached.analysisId,
          meta: { source: input.source, engineVersion: ENGINE_VERSION, inputHash }
        });

        return { ...cached, cached: true };
      }

      if (cached && !isValidAnalysisResult(cached)) {
        analysisResultCache.delete(cacheKey);
        await logEvent({
          level: 'error',
          type: 'analysis_cache_corrupted',
          message: 'Corrupted analysis cache entry discarded',
          requestId,
          userId: user.id,
          meta: { source: input.source, engineVersion: ENGINE_VERSION, inputHash }
        });
      }
    }

    const decision = await runAnalysis(input, user, { requestId, userId: user.id });

    const persisted = await withTransaction(async (client) => {
      const campaignRecord = await upsertCampaign(
        {
          userId: user.id,
          source: input.source,
          externalId: input.externalCampaignId,
          campaign: input.campaign
        },
        client
      );
      campaignId = campaignRecord.id;

      try {
        const saved = await saveAnalysisResult(
          {
            userId: user.id,
            campaignId: campaignRecord.id,
            source: input.source,
            inputHash: createAnalysisInputHash(input),
            engineVersion: ENGINE_VERSION,
            result: decision
          },
          client
        );
        analysisId = saved.id;
        return { saved, campaignRecord };
      } catch (error) {
        throw new HttpError(503, 'Failed to persist analysis result', {
          cause: error instanceof Error ? error.message : 'Database write failed',
          requestId,
          userId: user.id,
          campaignId: campaignRecord.id
        });
      }
    });

    const analysis: AnalysisResult = {
      analysisId: persisted.saved.id,
      campaignId: persisted.campaignRecord.id,
      userId: user.id,
      source: input.source,
      engineVersion: ENGINE_VERSION,
      cached: false,
      createdAt: persisted.saved.created_at,
      result: decision,
      exported: null
    };

    const exported = exportAnalysisResult(analysis, { requestId, userId: user.id, campaignId: analysis.campaignId, analysisId: analysis.analysisId });
    const finalResult: AnalysisResult = {
      ...analysis,
      exported
    };

    await logEvent({
      level: 'info',
      type: 'analysis_completed',
      message: `Analysis completed with verdict ${analysis.result.verdict}`,
      requestId,
      userId: user.id,
      campaignId: analysis.campaignId,
      analysisId: analysis.analysisId,
      meta: {
        source: input.source,
        confidence: analysis.result.confidence,
        issues: analysis.result.issues.map((item) => item.code),
        engineVersion: analysis.engineVersion,
        exported: Boolean(exported)
      }
    });

    if (featureFlags.enableAnalysisCache) {
      analysisResultCache.set(cacheKey, finalResult, inputHash);
    }

    return finalResult;
  } catch (error) {
    await logEvent({
      level: 'error',
      type: 'analysis_failed',
      message: error instanceof Error ? error.message : 'Analysis failed',
      requestId,
      userId: user.id,
      campaignId,
      analysisId,
      meta: {
        source: input?.source ?? null,
        engineVersion: ENGINE_VERSION,
        errorName: error instanceof Error ? error.name : 'UnknownError'
      }
    }).catch((logError) => {
      writeOperationalLog({
        level: 'error',
        type: 'analysis_failure_log_write_failed',
        requestId,
        userId: user.id,
        campaignId,
        analysisId,
        message: logError instanceof Error ? logError.message : 'Failed to write analysis failure log'
      });
    });

    throw error;
  }
}
