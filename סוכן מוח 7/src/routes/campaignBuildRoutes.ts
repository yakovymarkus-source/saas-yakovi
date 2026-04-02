import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { buildCampaignStrategy } from '../services/campaignBuildService';

export const campaignBuildRoutes = Router();

campaignBuildRoutes.use(authenticate);

campaignBuildRoutes.post('/:id/build', async (req, res, next) => {
  try {
    const result = await buildCampaignStrategy(req.params.id, req.body, req.user!);
    res.json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});
