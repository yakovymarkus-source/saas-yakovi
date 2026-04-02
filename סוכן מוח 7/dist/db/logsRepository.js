"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveLog = saveLog;
const id_1 = require("../utils/id");
const client_1 = require("./client");
async function saveLog(input, executor = client_1.pool) {
    await (0, client_1.queryDb)(executor, `INSERT INTO logs (id, request_id, user_id, campaign_id, analysis_id, level, type, message, meta, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, [
        (0, id_1.createId)(),
        input.requestId ?? null,
        input.userId ?? null,
        input.campaignId ?? null,
        input.analysisId ?? null,
        input.level,
        input.type,
        input.message,
        JSON.stringify(input.meta),
        input.timestamp
    ]);
}
