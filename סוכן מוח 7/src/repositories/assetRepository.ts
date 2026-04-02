import { createId } from '../utils/id';
import { type DbExecutor, pool, queryDb } from '../db/client';
import { CampaignAssetType, VersionedAsset } from '../domain/assets';

interface CampaignAssetRow {
  id: string;
  campaign_id: string;
  user_id: string;
  type: CampaignAssetType;
  version: number;
  angle: string;
  content: unknown;
  created_at: string;
}

export async function createVersionedAsset(
  input: {
    campaignId: string;
    userId: string;
    type: CampaignAssetType;
    angle: string;
    content: unknown;
  },
  executor: DbExecutor = pool
): Promise<VersionedAsset> {
  const versionResult = await queryDb<{ next_version: string }>(
    executor,
    `SELECT COALESCE(MAX(version), 0) + 1 AS next_version
     FROM campaign_assets
     WHERE campaign_id = $1 AND user_id = $2 AND type = $3`,
    [input.campaignId, input.userId, input.type]
  );
  const version = Number(versionResult.rows[0]?.next_version ?? 1);

  const { rows } = await queryDb<CampaignAssetRow>(
    executor,
    `INSERT INTO campaign_assets (id, campaign_id, user_id, type, version, angle, content)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [createId(), input.campaignId, input.userId, input.type, version, input.angle, JSON.stringify(input.content)]
  );

  const row = rows[0];
  return {
    id: row.id,
    campaignId: row.campaign_id,
    type: row.type,
    version: row.version,
    angle: row.angle,
    content: row.content,
    createdAt: row.created_at
  };
}

export async function listAssetsForCampaign(
  campaignId: string,
  userId: string,
  executor: DbExecutor = pool
): Promise<VersionedAsset[]> {
  const { rows } = await queryDb<CampaignAssetRow>(
    executor,
    `SELECT * FROM campaign_assets WHERE campaign_id = $1 AND user_id = $2 ORDER BY type, version DESC`,
    [campaignId, userId]
  );

  return rows.map((row: CampaignAssetRow) => ({
    id: row.id,
    campaignId: row.campaign_id,
    type: row.type,
    version: row.version,
    angle: row.angle,
    content: row.content,
    createdAt: row.created_at
  }));
}
