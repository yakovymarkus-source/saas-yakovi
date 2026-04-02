import { createId } from '../utils/id';
import { type DbExecutor, pool, queryDb } from './client';

export async function saveLog(
  input: {
    level: string;
    type: string;
    message: string;
    requestId?: string;
    userId?: string;
    campaignId?: string;
    analysisId?: string;
    meta: Record<string, unknown>;
    timestamp: string;
  },
  executor: DbExecutor = pool
): Promise<void> {
  await queryDb(
    executor,
    `INSERT INTO logs (id, request_id, user_id, campaign_id, analysis_id, level, type, message, meta, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      createId(),
      input.requestId ?? null,
      input.userId ?? null,
      input.campaignId ?? null,
      input.analysisId ?? null,
      input.level,
      input.type,
      input.message,
      JSON.stringify(input.meta),
      input.timestamp
    ]
  );
}
