"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveOptimizationRun = saveOptimizationRun;
const id_1 = require("../utils/id");
const client_1 = require("../db/client");
async function saveOptimizationRun(input, executor = client_1.pool) {
    const { rows } = await (0, client_1.queryDb)(executor, `INSERT INTO campaign_optimizations (id, campaign_id, user_id, input_payload, diagnosis_payload)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`, [(0, id_1.createId)(), input.campaignId, input.userId, JSON.stringify(input.inputPayload), JSON.stringify(input.diagnosisPayload)]);
    return rows[0];
}
