"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.analysisResultCache = void 0;
exports.executeAnalysis = executeAnalysis;
const crypto_1 = __importDefault(require("crypto"));
const campaignsRepository_1 = require("../db/campaignsRepository");
const analysisRepository_1 = require("../db/analysisRepository");
const logger_1 = require("../utils/logger");
const cache_1 = require("../utils/cache");
const env_1 = require("../config/env");
const versioning_1 = require("../engine/versioning");
const pipeline_1 = require("../engine/pipeline");
const permissions_1 = require("../auth/permissions");
const featureFlags_1 = require("../config/featureFlags");
const exporter_1 = require("../output/exporter");
const stableStringify_1 = require("../utils/stableStringify");
const http_1 = require("../utils/http");
const client_1 = require("../db/client");
exports.analysisResultCache = new cache_1.TtlCache(env_1.env.CACHE_TTL_SECONDS, versioning_1.ENGINE_VERSION);
function hashAnalysisInput(input, userId) {
    return crypto_1.default.createHash('sha256').update(`${userId}:${(0, stableStringify_1.stableStringify)(input)}`).digest('hex');
}
function isValidAnalysisResult(value) {
    if (!value || typeof value !== 'object')
        return false;
    const record = value;
    return typeof record.analysisId === 'string' && typeof record.campaignId === 'string' && typeof record.userId === 'string' && typeof record.engineVersion === 'string' && !!record.result;
}
async function executeAnalysis(input, user, requestId) {
    (0, permissions_1.requirePermission)(user, 'analysis:run');
    if (!input?.campaign) {
        throw new http_1.HttpError(400, 'Analysis input is missing campaign payload');
    }
    let campaignId;
    let analysisId;
    try {
        const inputHash = hashAnalysisInput(input, user.id);
        const cacheKey = (0, versioning_1.buildVersionedKey)(inputHash);
        await (0, logger_1.logEvent)({
            level: 'info',
            type: 'analysis_started',
            message: 'Analysis execution started',
            requestId,
            userId: user.id,
            meta: { source: input.source, inputHash, engineVersion: versioning_1.ENGINE_VERSION }
        });
        if (featureFlags_1.featureFlags.enableAnalysisCache) {
            const cached = exports.analysisResultCache.get(cacheKey);
            if (cached && isValidAnalysisResult(cached)) {
                await (0, logger_1.logEvent)({
                    level: 'info',
                    type: 'analysis_cache_hit',
                    message: `Analysis served from cache for campaign ${cached.campaignId}`,
                    requestId,
                    userId: user.id,
                    campaignId: cached.campaignId,
                    analysisId: cached.analysisId,
                    meta: { source: input.source, engineVersion: versioning_1.ENGINE_VERSION, inputHash }
                });
                return { ...cached, cached: true };
            }
            if (cached && !isValidAnalysisResult(cached)) {
                exports.analysisResultCache.delete(cacheKey);
                await (0, logger_1.logEvent)({
                    level: 'error',
                    type: 'analysis_cache_corrupted',
                    message: 'Corrupted analysis cache entry discarded',
                    requestId,
                    userId: user.id,
                    meta: { source: input.source, engineVersion: versioning_1.ENGINE_VERSION, inputHash }
                });
            }
        }
        const decision = await (0, pipeline_1.runAnalysis)(input, user, { requestId, userId: user.id });
        const persisted = await (0, client_1.withTransaction)(async (client) => {
            const campaignRecord = await (0, campaignsRepository_1.upsertCampaign)({
                userId: user.id,
                source: input.source,
                externalId: input.externalCampaignId,
                campaign: input.campaign
            }, client);
            campaignId = campaignRecord.id;
            try {
                const saved = await (0, analysisRepository_1.saveAnalysisResult)({
                    userId: user.id,
                    campaignId: campaignRecord.id,
                    source: input.source,
                    inputHash: (0, pipeline_1.createAnalysisInputHash)(input),
                    engineVersion: versioning_1.ENGINE_VERSION,
                    result: decision
                }, client);
                analysisId = saved.id;
                return { saved, campaignRecord };
            }
            catch (error) {
                throw new http_1.HttpError(503, 'Failed to persist analysis result', {
                    cause: error instanceof Error ? error.message : 'Database write failed',
                    requestId,
                    userId: user.id,
                    campaignId: campaignRecord.id
                });
            }
        });
        const analysis = {
            analysisId: persisted.saved.id,
            campaignId: persisted.campaignRecord.id,
            userId: user.id,
            source: input.source,
            engineVersion: versioning_1.ENGINE_VERSION,
            cached: false,
            createdAt: persisted.saved.created_at,
            result: decision,
            exported: null
        };
        const exported = (0, exporter_1.exportAnalysisResult)(analysis, { requestId, userId: user.id, campaignId: analysis.campaignId, analysisId: analysis.analysisId });
        const finalResult = {
            ...analysis,
            exported
        };
        await (0, logger_1.logEvent)({
            level: 'info',
            type: 'analysis_completed',
            message: `Analysis completed with verdict ${analysis.result.verdict}`,
            requestId,
            userId: user.id,
            campaignId: analysis.campaignId,
            analysisId: analysis.analysisId,
            meta: {
                source: input.source,
                confidence: analysis.result.confidence,
                issues: analysis.result.issues.map((item) => item.code),
                engineVersion: analysis.engineVersion,
                exported: Boolean(exported)
            }
        });
        if (featureFlags_1.featureFlags.enableAnalysisCache) {
            exports.analysisResultCache.set(cacheKey, finalResult, inputHash);
        }
        return finalResult;
    }
    catch (error) {
        await (0, logger_1.logEvent)({
            level: 'error',
            type: 'analysis_failed',
            message: error instanceof Error ? error.message : 'Analysis failed',
            requestId,
            userId: user.id,
            campaignId,
            analysisId,
            meta: {
                source: input?.source ?? null,
                engineVersion: versioning_1.ENGINE_VERSION,
                errorName: error instanceof Error ? error.name : 'UnknownError'
            }
        }).catch((logError) => {
            (0, logger_1.writeOperationalLog)({
                level: 'error',
                type: 'analysis_failure_log_write_failed',
                requestId,
                userId: user.id,
                campaignId,
                analysisId,
                message: logError instanceof Error ? logError.message : 'Failed to write analysis failure log'
            });
        });
        throw error;
    }
}
