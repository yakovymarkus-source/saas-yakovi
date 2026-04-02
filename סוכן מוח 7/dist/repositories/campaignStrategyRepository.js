"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveCampaignStrategy = saveCampaignStrategy;
const id_1 = require("../utils/id");
const client_1 = require("../db/client");
async function saveCampaignStrategy(input, executor = client_1.pool) {
    const existing = await (0, client_1.queryDb)(executor, `SELECT * FROM campaign_strategies WHERE campaign_id = $1 AND user_id = $2 LIMIT 1`, [input.campaignId, input.userId]);
    if (existing.rows[0]) {
        const { rows } = await (0, client_1.queryDb)(executor, `UPDATE campaign_strategies
       SET strategy_payload = $1, verdict_payload = $2, updated_at = NOW()
       WHERE id = $3
       RETURNING *`, [JSON.stringify(input.strategyPayload), JSON.stringify(input.verdictPayload), existing.rows[0].id]);
        return rows[0];
    }
    const { rows } = await (0, client_1.queryDb)(executor, `INSERT INTO campaign_strategies (id, campaign_id, user_id, strategy_payload, verdict_payload)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`, [(0, id_1.createId)(), input.campaignId, input.userId, JSON.stringify(input.strategyPayload), JSON.stringify(input.verdictPayload)]);
    return rows[0];
}
