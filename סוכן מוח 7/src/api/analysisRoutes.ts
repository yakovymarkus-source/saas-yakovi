import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate';
import { analysisRequestSchema } from '../integrations/schemas';
import { executeAnalysis } from '../services/analysisService';
import { queryAnalysis } from '../engine/queryEngine';
import { updateExecutionSync, getExecutionSync, getPendingActions } from '../engine/executionSync';
import { HttpError } from '../utils/http';

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

// Query Engine — שאל שאלה על ניתוח קיים
analysisRoutes.post('/query', async (req, res, next) => {
  try {
    const { query, analysisResult } = z.object({
      query: z.string().min(3).max(500),
      analysisResult: z.object({
        result: z.any(),
        computed: z.any().optional(),
        normalized: z.any().optional()
      })
    }).parse(req.body);

    const engineResult = analysisResult.result;
    const computed = engineResult?.metrics ?? analysisResult.computed ?? {};
    const normalized = engineResult?.normalizedMetrics ?? analysisResult.normalized ?? {};

    if (!engineResult?.verdict) {
      throw new HttpError(400, 'analysisResult.result must contain a valid EngineResult');
    }

    const response = queryAnalysis(query, engineResult, computed, normalized);
    res.json({ ok: true, ...response });
  } catch (error) {
    next(error);
  }
});

// Execution Sync — עדכן סטטוס ביצוע פעולה
analysisRoutes.patch('/execution/:analysisId', async (req, res, next) => {
  try {
    const { analysisId } = req.params;
    const updates = z.array(z.object({
      actionCode: z.string(),
      status: z.enum(['pending', 'executed', 'skipped']),
      executedAt: z.string().optional()
    })).parse(req.body);

    const updated = updateExecutionSync(analysisId, updates);
    res.json({ ok: true, sync: updated });
  } catch (error) {
    next(error);
  }
});

// Execution Sync — קבל סטטוס ביצוע
analysisRoutes.get('/execution/:analysisId', async (req, res, next) => {
  try {
    const { analysisId } = req.params;
    const sync = getExecutionSync(analysisId);
    const pending = getPendingActions(analysisId);
    res.json({ ok: true, sync, pendingCount: pending.length });
  } catch (error) {
    next(error);
  }
});
