import { z } from 'zod';

const featureFlagsSchema = z.object({
  enableAnalysisCache: z.boolean().default(true),
  enableAnalysisExport: z.boolean().default(true),
  enableStrictPermissions: z.boolean().default(true)
});

export const featureFlags = featureFlagsSchema.parse({
  enableAnalysisCache: process.env.FEATURE_ANALYSIS_CACHE !== 'false',
  enableAnalysisExport: process.env.FEATURE_ANALYSIS_EXPORT !== 'false',
  enableStrictPermissions: process.env.FEATURE_STRICT_PERMISSIONS !== 'false'
});
