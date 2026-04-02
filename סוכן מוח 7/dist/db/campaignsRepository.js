"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.upsertCampaign = upsertCampaign;
exports.getCampaignById = getCampaignById;
const id_1 = require("../utils/id");
const client_1 = require("./client");
async function upsertCampaign(input, executor = client_1.pool) {
    const existing = input.externalId
        ? await (0, client_1.queryDb)(executor, `SELECT * FROM campaigns WHERE user_id = $1 AND source = $2 AND external_id = $3 LIMIT 1`, [input.userId, input.source, input.externalId])
        : { rows: [] };
    if (existing.rows[0]) {
        const { rows } = await (0, client_1.queryDb)(executor, `UPDATE campaigns
       SET name = $1, objective = $2, currency = $3, payload = $4, updated_at = NOW()
       WHERE id = $5
       RETURNING *`, [input.campaign.name, input.campaign.objective, input.campaign.currency, JSON.stringify(input.campaign), existing.rows[0].id]);
        return rows[0];
    }
    const { rows } = await (0, client_1.queryDb)(executor, `INSERT INTO campaigns (id, user_id, external_id, name, source, objective, currency, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`, [(0, id_1.createId)(), input.userId, input.externalId ?? null, input.campaign.name, input.source, input.campaign.objective, input.campaign.currency, JSON.stringify(input.campaign)]);
    return rows[0];
}
async function getCampaignById(campaignId, userId, executor = client_1.pool) {
    const { rows } = await (0, client_1.queryDb)(executor, `SELECT * FROM campaigns WHERE id = $1 AND user_id = $2 LIMIT 1`, [campaignId, userId]);
    return rows[0] ?? null;
}
