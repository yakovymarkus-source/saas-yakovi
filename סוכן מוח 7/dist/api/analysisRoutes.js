"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analysisRoutes = void 0;
const express_1 = require("express");
const authenticate_1 = require("../middleware/authenticate");
const schemas_1 = require("../integrations/schemas");
const analysisService_1 = require("../services/analysisService");
exports.analysisRoutes = (0, express_1.Router)();
exports.analysisRoutes.use(authenticate_1.authenticate);
exports.analysisRoutes.post('/run', async (req, res, next) => {
    try {
        const payload = schemas_1.analysisRequestSchema.parse(req.body);
        const result = await (0, analysisService_1.executeAnalysis)(payload, req.user, req.requestId);
        res.json({
            ok: true,
            cached: result.cached,
            campaignId: result.campaignId,
            analysisId: result.analysisId,
            engineVersion: result.engineVersion,
            result: result.result,
            exported: result.exported ?? null
        });
    }
    catch (error) {
        next(error);
    }
});
