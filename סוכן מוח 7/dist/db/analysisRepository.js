"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveAnalysisResult = saveAnalysisResult;
const id_1 = require("../utils/id");
const client_1 = require("./client");
async function saveAnalysisResult(input, executor = client_1.pool) {
    const id = (0, id_1.createId)();
    const { rows } = await (0, client_1.queryDb)(executor, `INSERT INTO analysis_results (id, user_id, campaign_id, source, input_hash, engine_version, result)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, user_id, campaign_id, source, input_hash, engine_version, result, created_at`, [id, input.userId, input.campaignId, input.source, input.inputHash, input.engineVersion, JSON.stringify(input.result)]);
    return rows[0];
}
