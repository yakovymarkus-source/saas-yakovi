"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.campaignBuildRoutes = void 0;
const express_1 = require("express");
const authenticate_1 = require("../middleware/authenticate");
const campaignBuildService_1 = require("../services/campaignBuildService");
exports.campaignBuildRoutes = (0, express_1.Router)();
exports.campaignBuildRoutes.use(authenticate_1.authenticate);
exports.campaignBuildRoutes.post('/:id/build', async (req, res, next) => {
    try {
        const result = await (0, campaignBuildService_1.buildCampaignStrategy)(req.params.id, req.body, req.user);
        res.json({ ok: true, ...result });
    }
    catch (error) {
        next(error);
    }
});
