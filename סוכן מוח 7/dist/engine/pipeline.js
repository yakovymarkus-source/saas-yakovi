"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAnalysisInputHash = createAnalysisInputHash;
exports.runAnalysis = runAnalysis;
const crypto_1 = __importDefault(require("crypto"));
const metricsProvider_1 = require("../integrations/metricsProvider");
const normalize_1 = require("./normalize");
const metrics_1 = require("./metrics");
const decisionEngine_1 = require("./decisionEngine");
const stableStringify_1 = require("../utils/stableStringify");
const http_1 = require("../utils/http");
const logger_1 = require("../utils/logger");
function createAnalysisInputHash(input) {
    return crypto_1.default.createHash('sha256').update((0, stableStringify_1.stableStringify)(input)).digest('hex');
}
function assertAnalysisInput(input) {
    if (!input || typeof input !== 'object') {
        throw new http_1.HttpError(400, 'Analysis input must be an object');
    }
    if (!input.source || !['meta', 'googleAds', 'ga4'].includes(input.source)) {
        throw new http_1.HttpError(400, 'Analysis source is invalid');
    }
    if (!input.campaign || typeof input.campaign !== 'object') {
        throw new http_1.HttpError(400, 'Analysis input is missing campaign payload');
    }
    if (!input.campaign.name?.trim()) {
        throw new http_1.HttpError(400, 'Campaign name is required');
    }
    if (!input.campaign.objective) {
        throw new http_1.HttpError(400, 'Campaign objective is required');
    }
    if (!input.campaign.currency || input.campaign.currency.trim().length !== 3) {
        throw new http_1.HttpError(400, 'Campaign currency must be a 3-letter ISO code');
    }
    if ((0, stableStringify_1.stableStringify)(input).length > 256_000) {
        throw new http_1.HttpError(413, 'Analysis input is too large');
    }
}
async function runAnalysis(input, _user, context = {}) {
    assertAnalysisInput(input);
    await (0, logger_1.logEvent)({
        level: 'info',
        type: 'analysis_pipeline_started',
        message: 'Analysis pipeline started',
        requestId: context.requestId,
        userId: context.userId,
        campaignId: context.campaignId,
        analysisId: context.analysisId,
        meta: { source: input.source }
    });
    try {
        const metrics = await (0, metricsProvider_1.resolveMetrics)(input);
        const normalized = (0, normalize_1.normalizeMetrics)(metrics);
        const computed = (0, metrics_1.computeMetrics)(normalized);
        const result = (0, decisionEngine_1.runDecisionEngine)(input.campaign, normalized, computed);
        await (0, logger_1.logEvent)({
            level: 'info',
            type: 'analysis_pipeline_completed',
            message: 'Analysis pipeline completed',
            requestId: context.requestId,
            userId: context.userId,
            campaignId: context.campaignId,
            analysisId: context.analysisId,
            meta: {
                source: input.source,
                verdict: result.verdict,
                confidence: result.confidence,
                engineVersion: result.decisionLog.engineVersion
            }
        });
        return result;
    }
    catch (error) {
        await (0, logger_1.logEvent)({
            level: 'error',
            type: 'analysis_pipeline_failed',
            message: error instanceof Error ? error.message : 'Analysis pipeline failed',
            requestId: context.requestId,
            userId: context.userId,
            campaignId: context.campaignId,
            analysisId: context.analysisId,
            meta: {
                source: input.source,
                errorName: error instanceof Error ? error.name : 'UnknownError'
            }
        }).catch(() => undefined);
        if (error instanceof http_1.HttpError) {
            throw error;
        }
        const message = error instanceof Error ? error.message : 'Analysis pipeline failed';
        throw new http_1.HttpError(500, 'Analysis pipeline failed', { cause: message });
    }
}
