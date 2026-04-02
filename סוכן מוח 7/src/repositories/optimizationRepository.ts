import { createId } from '../utils/id';
import { type DbExecutor, pool, queryDb } from '../db/client';

export interface CampaignOptimizationRecord {
  id: string;
  campaign_id: string;
  user_id: string;
  input_payload: unknown;
  diagnosis_payload: unknown;
  created_at: string;
}

export async function saveOptimizationRun(
  input: {
    campaignId: string;
    userId: string;
    inputPayload: unknown;
    diagnosisPayload: unknown;
  },
  executor: DbExecutor = pool
): Promise<CampaignOptimizationRecord> {
  const { rows } = await queryDb<CampaignOptimizationRecord>(
    executor,
    `INSERT INTO campaign_optimizations (id, campaign_id, user_id, input_payload, diagnosis_payload)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [createId(), input.campaignId, input.userId, JSON.stringify(input.inputPayload), JSON.stringify(input.diagnosisPayload)]
  );
  return rows[0];
}
