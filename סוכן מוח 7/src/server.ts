import express from 'express';
import path from 'path';
import { env } from './config/env';
import { requestContext } from './middleware/requestContext';
import { errorHandler } from './middleware/errorHandler';
import { authRoutes } from './api/authRoutes';
import { analysisRoutes } from './api/analysisRoutes';
import { healthRoutes } from './api/healthRoutes';
import { campaignBuildRoutes } from './routes/campaignBuildRoutes';
import { campaignAssetsRoutes } from './routes/campaignAssetsRoutes';
import { campaignOptimizationRoutes } from './routes/campaignOptimizationRoutes';
import { orchestrationRoutes } from './api/orchestrationRoutes';
import { writeOperationalLog } from './utils/logger';

export function createApp(): express.Express {
  const app = express();
  const frontendPath = path.resolve(process.cwd(), 'frontend');

  app.use(express.json({ limit: '1mb' }));
  app.use(requestContext);
  app.use(express.static(frontendPath));
  app.use('/api/health', healthRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/analysis', analysisRoutes);
  app.use('/api/campaigns', campaignBuildRoutes);
  app.use('/api/campaigns', campaignAssetsRoutes);
  app.use('/api/campaigns', campaignOptimizationRoutes);
  app.use('/api/orchestration', orchestrationRoutes);
  app.get('*', (_req, res) => res.sendFile(path.join(frontendPath, 'index.html')));
  app.use(errorHandler);

  return app;
}

if (require.main === module) {
  const app = createApp();
  app.listen(env.PORT, () => {
    writeOperationalLog({
      level: 'info',
      type: 'server_started',
      message: `campaign-brain-saas listening on ${env.PORT}`
    });
  });
}
