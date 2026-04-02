import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { optimizeCampaign } from '../services/campaignBuildService';

export const campaignOptimizationRoutes = Router();

campaignOptimizationRoutes.use(authenticate);

campaignOptimizationRoutes.post('/:id/optimize', async (req, res, next) => {
  try {
    const result = await optimizeCampaign(req.params.id, req.body, req.user!);
    res.json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});
