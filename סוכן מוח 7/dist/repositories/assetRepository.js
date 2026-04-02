"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createVersionedAsset = createVersionedAsset;
exports.listAssetsForCampaign = listAssetsForCampaign;
const id_1 = require("../utils/id");
const client_1 = require("../db/client");
async function createVersionedAsset(input, executor = client_1.pool) {
    const versionResult = await (0, client_1.queryDb)(executor, `SELECT COALESCE(MAX(version), 0) + 1 AS next_version
     FROM campaign_assets
     WHERE campaign_id = $1 AND user_id = $2 AND type = $3`, [input.campaignId, input.userId, input.type]);
    const version = Number(versionResult.rows[0]?.next_version ?? 1);
    const { rows } = await (0, client_1.queryDb)(executor, `INSERT INTO campaign_assets (id, campaign_id, user_id, type, version, angle, content)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`, [(0, id_1.createId)(), input.campaignId, input.userId, input.type, version, input.angle, JSON.stringify(input.content)]);
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
async function listAssetsForCampaign(campaignId, userId, executor = client_1.pool) {
    const { rows } = await (0, client_1.queryDb)(executor, `SELECT * FROM campaign_assets WHERE campaign_id = $1 AND user_id = $2 ORDER BY type, version DESC`, [campaignId, userId]);
    return rows.map((row) => ({
        id: row.id,
        campaignId: row.campaign_id,
        type: row.type,
        version: row.version,
        angle: row.angle,
        content: row.content,
        createdAt: row.created_at
    }));
}
