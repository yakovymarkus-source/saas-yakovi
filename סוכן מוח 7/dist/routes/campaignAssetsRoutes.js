"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.campaignAssetsRoutes = void 0;
const express_1 = require("express");
const authenticate_1 = require("../middleware/authenticate");
const campaignBuildService_1 = require("../services/campaignBuildService");
exports.campaignAssetsRoutes = (0, express_1.Router)();
exports.campaignAssetsRoutes.use(authenticate_1.authenticate);
exports.campaignAssetsRoutes.post('/:id/assets/landing-page', async (req, res, next) => {
    try {
        const result = await (0, campaignBuildService_1.regenerateLandingPage)(req.params.id, req.body, req.user);
        res.json({ ok: true, ...result });
    }
    catch (error) {
        next(error);
    }
});
exports.campaignAssetsRoutes.post('/:id/assets/ads', async (req, res, next) => {
    try {
        const result = await (0, campaignBuildService_1.regenerateAds)(req.params.id, req.body, req.user);
        res.json({ ok: true, ...result });
    }
    catch (error) {
        next(error);
    }
});
exports.campaignAssetsRoutes.post('/:id/assets/video-scripts', async (req, res, next) => {
    try {
        const result = await (0, campaignBuildService_1.regenerateVideoScripts)(req.params.id, req.body, req.user);
        res.json({ ok: true, ...result });
    }
    catch (error) {
        next(error);
    }
});
