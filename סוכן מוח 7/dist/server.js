"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApp = createApp;
const express_1 = __importDefault(require("express"));
const path_1 = __importDefault(require("path"));
const env_1 = require("./config/env");
const requestContext_1 = require("./middleware/requestContext");
const errorHandler_1 = require("./middleware/errorHandler");
const authRoutes_1 = require("./api/authRoutes");
const analysisRoutes_1 = require("./api/analysisRoutes");
const healthRoutes_1 = require("./api/healthRoutes");
const campaignBuildRoutes_1 = require("./routes/campaignBuildRoutes");
const campaignAssetsRoutes_1 = require("./routes/campaignAssetsRoutes");
const campaignOptimizationRoutes_1 = require("./routes/campaignOptimizationRoutes");
const logger_1 = require("./utils/logger");
function createApp() {
    const app = (0, express_1.default)();
    const frontendPath = path_1.default.resolve(process.cwd(), 'frontend');
    app.use(express_1.default.json({ limit: '1mb' }));
    app.use(requestContext_1.requestContext);
    app.use(express_1.default.static(frontendPath));
    app.use('/api/health', healthRoutes_1.healthRoutes);
    app.use('/api/auth', authRoutes_1.authRoutes);
    app.use('/api/analysis', analysisRoutes_1.analysisRoutes);
    app.use('/api/campaigns', campaignBuildRoutes_1.campaignBuildRoutes);
    app.use('/api/campaigns', campaignAssetsRoutes_1.campaignAssetsRoutes);
    app.use('/api/campaigns', campaignOptimizationRoutes_1.campaignOptimizationRoutes);
    app.get('*', (_req, res) => res.sendFile(path_1.default.join(frontendPath, 'index.html')));
    app.use(errorHandler_1.errorHandler);
    return app;
}
if (require.main === module) {
    const app = createApp();
    app.listen(env_1.env.PORT, () => {
        (0, logger_1.writeOperationalLog)({
            level: 'info',
            type: 'server_started',
            message: `campaign-brain-saas listening on ${env_1.env.PORT}`
        });
    });
}
