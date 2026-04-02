import { createId } from '../utils/id';
import { type DbExecutor, pool, queryDb } from '../db/client';

export interface CampaignStrategyRecord {
  id: string;
  campaign_id: string;
  user_id: string;
  strategy_payload: unknown;
  verdict_payload: unknown;
  created_at: string;
  updated_at: string;
}

export async function saveCampaignStrategy(
  input: {
    campaignId: string;
    userId: string;
    strategyPayload: unknown;
    verdictPayload: unknown;
  },
  executor: DbExecutor = pool
): Promise<CampaignStrategyRecord> {
  const existing = await queryDb<CampaignStrategyRecord>(
    executor,
    `SELECT * FROM campaign_strategies WHERE campaign_id = $1 AND user_id = $2 LIMIT 1`,
    [input.campaignId, input.userId]
  );

  if (existing.rows[0]) {
    const { rows } = await queryDb<CampaignStrategyRecord>(
      executor,
      `UPDATE campaign_strategies
       SET strategy_payload = $1, verdict_payload = $2, updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [JSON.stringify(input.strategyPayload), JSON.stringify(input.verdictPayload), existing.rows[0].id]
    );
    return rows[0];
  }

  const { rows } = await queryDb<CampaignStrategyRecord>(
    executor,
    `INSERT INTO campaign_strategies (id, campaign_id, user_id, strategy_payload, verdict_payload)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [createId(), input.campaignId, input.userId, JSON.stringify(input.strategyPayload), JSON.stringify(input.verdictPayload)]
  );
  return rows[0];
}
