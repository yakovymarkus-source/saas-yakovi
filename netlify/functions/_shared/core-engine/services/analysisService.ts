import crypto from 'crypto';
import { runAnalysis } from '../engine/pipeline';
import { AnalysisRequest, AnalysisResult, AuthenticatedUser } from '../types/domain';
import { buildVersionedKey, ENGINE_VERSION } from '../engine/versioning';
import { HttpError } from '../utils/http';

export async function executeAnalysis(
  input: AnalysisRequest,
  user: AuthenticatedUser,
  requestId?: string
): Promise<AnalysisResult> {
  if (!input?.campaign) {
    throw new HttpError(400, 'Analysis input is missing campaign payload');
  }

  const analysisId = requestId || crypto.randomUUID();
  const campaignId = input.externalCampaignId || 'ad-hoc';

  const engineResult = await runAnalysis(input, user, {
    requestId: analysisId,
    userId: user.id,
    campaignId,
    analysisId,
  });

  return {
    analysisId,
    campaignId,
    userId: user.id,
    source: input.source,
    engineVersion: ENGINE_VERSION,
    cached: false,
    createdAt: new Date().toISOString(),
    result: engineResult,
  };
}
