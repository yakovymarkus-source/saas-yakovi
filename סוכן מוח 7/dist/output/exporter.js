"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.exportAnalysisResult = exportAnalysisResult;
const featureFlags_1 = require("../config/featureFlags");
const stableStringify_1 = require("../utils/stableStringify");
const http_1 = require("../utils/http");
const logger_1 = require("../utils/logger");
function sanitizeForExport(value, seen = new WeakSet()) {
    if (value === null || value === undefined)
        return null;
    if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean')
        return value;
    if (typeof value === 'bigint')
        return value.toString();
    if (value instanceof Date)
        return value.toISOString();
    if (Array.isArray(value))
        return value.map((item) => sanitizeForExport(item, seen));
    if (typeof value === 'object') {
        if (seen.has(value)) {
            throw new http_1.HttpError(500, 'Analysis export failed because payload is circular');
        }
        seen.add(value);
        const output = {};
        for (const key of Object.keys(value).sort()) {
            const sanitized = sanitizeForExport(value[key], seen);
            output[key] = sanitized ?? null;
        }
        seen.delete(value);
        return output;
    }
    return String(value);
}
function assertExportableAnalysisResult(result) {
    if (!result?.analysisId || !result?.campaignId || !result?.userId || !result?.engineVersion || !result?.result) {
        throw new http_1.HttpError(500, 'Analysis export failed because result is incomplete');
    }
}
function exportAnalysisResult(result, context = {}) {
    if (!featureFlags_1.featureFlags.enableAnalysisExport)
        return null;
    assertExportableAnalysisResult(result);
    const exportable = sanitizeForExport({
        analysisId: result.analysisId,
        campaignId: result.campaignId,
        userId: result.userId,
        source: result.source,
        engineVersion: result.engineVersion,
        cached: result.cached,
        createdAt: result.createdAt,
        result: result.result
    });
    const data = (0, stableStringify_1.stableStringify)(exportable);
    void (0, logger_1.logEvent)({
        level: 'info',
        type: 'analysis_export_generated',
        message: 'Analysis export generated',
        requestId: context.requestId,
        userId: context.userId,
        campaignId: context.campaignId,
        analysisId: context.analysisId,
        meta: { bytes: Buffer.byteLength(data, 'utf8'), engineVersion: result.engineVersion }
    }).catch(() => undefined);
    return {
        format: 'json',
        fileName: `analysis-${result.analysisId}.json`,
        contentType: 'application/json',
        data
    };
}
