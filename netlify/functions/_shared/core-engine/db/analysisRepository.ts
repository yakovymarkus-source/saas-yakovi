import { createId } from '../utils/id';
import { EngineResult, SourcePlatform } from '../types/domain';
import { type DbExecutor, pool, queryDb } from './client';

export interface PersistedAnalysisRecord {
  id: string;
  user_id: string;
  campaign_id: string;
  source: SourcePlatform;
  input_hash: string;
  engine_version: string;
  result: EngineResult;
  created_at: string;
}

export async function saveAnalysisResult(
  input: {
    userId: string;
    campaignId: string;
    source: SourcePlatform;
    inputHash: string;
    engineVersion: string;
    result: EngineResult;
  },
  executor: DbExecutor = pool
): Promise<PersistedAnalysisRecord> {
  const id = createId();
  const { rows } = await queryDb<PersistedAnalysisRecord>(
    executor,
    `INSERT INTO analysis_results (id, user_id, campaign_id, source, input_hash, engine_version, result)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, user_id, campaign_id, source, input_hash, engine_version, result, created_at`,
    [id, input.userId, input.campaignId, input.source, input.inputHash, input.engineVersion, JSON.stringify(input.result)]
  );

  return rows[0];
}
