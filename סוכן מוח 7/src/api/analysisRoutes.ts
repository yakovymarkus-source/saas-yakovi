import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { analysisRequestSchema } from '../integrations/schemas';
import { executeAnalysis } from '../services/analysisService';

export const analysisRoutes = Router();

analysisRoutes.use(authenticate);

analysisRoutes.post('/run', async (req, res, next) => {
  try {
    const payload = analysisRequestSchema.parse(req.body);
    const result = await executeAnalysis(payload, req.user!, req.requestId);
    res.json({
      ok: true,
      cached: result.cached,
      campaignId: result.campaignId,
      analysisId: result.analysisId,
      engineVersion: result.engineVersion,
      result: result.result,
      exported: result.exported ?? null
    });
  } catch (error) {
    next(error);
  }
});
