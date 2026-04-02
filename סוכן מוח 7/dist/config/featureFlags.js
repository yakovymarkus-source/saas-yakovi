"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.featureFlags = void 0;
const zod_1 = require("zod");
const featureFlagsSchema = zod_1.z.object({
    enableAnalysisCache: zod_1.z.boolean().default(true),
    enableAnalysisExport: zod_1.z.boolean().default(true),
    enableStrictPermissions: zod_1.z.boolean().default(true)
});
exports.featureFlags = featureFlagsSchema.parse({
    enableAnalysisCache: process.env.FEATURE_ANALYSIS_CACHE !== 'false',
    enableAnalysisExport: process.env.FEATURE_ANALYSIS_EXPORT !== 'false',
    enableStrictPermissions: process.env.FEATURE_STRICT_PERMISSIONS !== 'false'
});
