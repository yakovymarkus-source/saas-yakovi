"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.campaignOptimizationRoutes = void 0;
const express_1 = require("express");
const authenticate_1 = require("../middleware/authenticate");
const campaignBuildService_1 = require("../services/campaignBuildService");
exports.campaignOptimizationRoutes = (0, express_1.Router)();
exports.campaignOptimizationRoutes.use(authenticate_1.authenticate);
exports.campaignOptimizationRoutes.post('/:id/optimize', async (req, res, next) => {
    try {
        const result = await (0, campaignBuildService_1.optimizeCampaign)(req.params.id, req.body, req.user);
        res.json({ ok: true, ...result });
    }
    catch (error) {
        next(error);
    }
});
