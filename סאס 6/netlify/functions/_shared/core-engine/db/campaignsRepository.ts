import { createId } from '../utils/id';
import { CampaignPayload, CampaignRecord, SourcePlatform } from '../types/domain';
import { type DbExecutor, pool, queryDb } from './client';

export async function upsertCampaign(
  input: {
    userId: string;
    source: SourcePlatform;
    externalId?: string;
    campaign: CampaignPayload;
  },
  executor: DbExecutor = pool
): Promise<CampaignRecord> {
  const existing = input.externalId
    ? await queryDb<CampaignRecord>(
        executor,
        `SELECT * FROM campaigns WHERE user_id = $1 AND source = $2 AND external_id = $3 LIMIT 1`,
        [input.userId, input.source, input.externalId]
      )
    : { rows: [] as CampaignRecord[] };

  if (existing.rows[0]) {
    const { rows } = await queryDb<CampaignRecord>(
      executor,
      `UPDATE campaigns
       SET name = $1, objective = $2, currency = $3, payload = $4, updated_at = NOW()
       WHERE id = $5
       RETURNING *`,
      [input.campaign.name, input.campaign.objective, input.campaign.currency, JSON.stringify(input.campaign), existing.rows[0].id]
    );
    return rows[0];
  }

  const { rows } = await queryDb<CampaignRecord>(
    executor,
    `INSERT INTO campaigns (id, user_id, external_id, name, source, objective, currency, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [createId(), input.userId, input.externalId ?? null, input.campaign.name, input.source, input.campaign.objective, input.campaign.currency, JSON.stringify(input.campaign)]
  );
  return rows[0];
}


export async function getCampaignById(
  campaignId: string,
  userId: string,
  executor: DbExecutor = pool
): Promise<CampaignRecord | null> {
  const { rows } = await queryDb<CampaignRecord>(
    executor,
    `SELECT * FROM campaigns WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [campaignId, userId]
  );
  return rows[0] ?? null;
}
