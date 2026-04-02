import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { regenerateAds, regenerateLandingPage, regenerateVideoScripts } from '../services/campaignBuildService';

export const campaignAssetsRoutes = Router();

campaignAssetsRoutes.use(authenticate);

campaignAssetsRoutes.post('/:id/assets/landing-page', async (req, res, next) => {
  try {
    const result = await regenerateLandingPage(req.params.id, req.body, req.user!);
    res.json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});

campaignAssetsRoutes.post('/:id/assets/ads', async (req, res, next) => {
  try {
    const result = await regenerateAds(req.params.id, req.body, req.user!);
    res.json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});

campaignAssetsRoutes.post('/:id/assets/video-scripts', async (req, res, next) => {
  try {
    const result = await regenerateVideoScripts(req.params.id, req.body, req.user!);
    res.json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});
