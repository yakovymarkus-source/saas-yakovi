import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate';
import { HttpError } from '../utils/http';
import {
  startSession,
  getSessionById,
  tick,
  runResearchAgent,
  runStrategyAgent,
  runExecutionAgent,
  runQaAgent,
  runAnalysisAgentOnSession,
  handleApprovalResponse,
  getProactiveSuggestions
} from '../orchestration/superLayer';

export const orchestrationRoutes = Router();
orchestrationRoutes.use(authenticate);

// ── Session management ────────────────────────────────────────────────────────

// POST /orchestration/sessions — פתח session חדש
orchestrationRoutes.post('/sessions', async (req, res, next) => {
  try {
    const body = z.object({
      campaignId: z.string(),
      automationLevel: z.enum(['manual', 'semi', 'auto']).default('semi'),
      goal: z.object({
        type: z.enum(['leads', 'sales', 'followers', 'conversion_improvement']),
        target: z.number(),
        timeframe: z.string(),
        metric: z.string()
      })
    }).parse(req.body);

    const session = startSession(req.user!.id, body.campaignId, body.goal, body.automationLevel);
    res.status(201).json({ ok: true, sessionId: session.id, state: session.state });
  } catch (e) { next(e); }
});

// GET /orchestration/sessions/:id — קבל מצב session
orchestrationRoutes.get('/sessions/:id', async (req, res, next) => {
  try {
    const session = getSessionById(req.params.id);
    if (session.userId !== req.user!.id) throw new HttpError(403, 'Forbidden');
    res.json({
      ok: true,
      sessionId: session.id,
      state: session.state,
      iterationCount: session.iterationCount,
      failureCount: session.failureCount,
      automationLevel: session.automationLevel,
      goal: session.goal,
      pendingApprovals: session.pendingApprovals.filter(c => c.status === 'pending'),
      resourceUsage: session.resourceUsage,
      updatedAt: session.updatedAt
    });
  } catch (e) { next(e); }
});

// ── Tick — "what to do next" ──────────────────────────────────────────────────

// POST /orchestration/sessions/:id/tick
orchestrationRoutes.post('/sessions/:id/tick', async (req, res, next) => {
  try {
    const session = getSessionById(req.params.id);
    if (session.userId !== req.user!.id) throw new HttpError(403, 'Forbidden');
    const result = tick(req.params.id);
    res.json({ ok: true, ...result });
  } catch (e) { next(e); }
});

// ── Agent runners ─────────────────────────────────────────────────────────────

const buildInputSchema = z.object({
  business: z.object({
    name: z.string(),
    category: z.string(),
    offer: z.string(),
    pricing: z.object({ amount: z.number().optional(), currency: z.string().default('ILS') }).optional(),
    budget: z.object({ monthly: z.number().optional(), currency: z.string().default('ILS') }).optional(),
    constraints: z.array(z.string()).optional()
  })
});

// POST /orchestration/sessions/:id/research
orchestrationRoutes.post('/sessions/:id/research', async (req, res, next) => {
  try {
    const session = getSessionById(req.params.id);
    if (session.userId !== req.user!.id) throw new HttpError(403, 'Forbidden');
    const buildInput = buildInputSchema.parse(req.body);
    const result = await runResearchAgent(req.params.id, buildInput as any, req.user!);
    res.json({ ok: true, ...result });
  } catch (e) { next(e); }
});

// POST /orchestration/sessions/:id/strategy
orchestrationRoutes.post('/sessions/:id/strategy', async (req, res, next) => {
  try {
    const session = getSessionById(req.params.id);
    if (session.userId !== req.user!.id) throw new HttpError(403, 'Forbidden');
    const { campaignId, buildInput } = z.object({
      campaignId: z.string(),
      buildInput: buildInputSchema
    }).parse(req.body);
    const result = await runStrategyAgent(req.params.id, campaignId, buildInput as any, req.user!);
    res.json({ ok: true, ...result });
  } catch (e) { next(e); }
});

// POST /orchestration/sessions/:id/execute
orchestrationRoutes.post('/sessions/:id/execute', async (req, res, next) => {
  try {
    const session = getSessionById(req.params.id);
    if (session.userId !== req.user!.id) throw new HttpError(403, 'Forbidden');
    const { campaignId, buildInput, target } = z.object({
      campaignId: z.string(),
      buildInput: buildInputSchema,
      target: z.enum(['landing', 'ads', 'video', 'all']).optional()
    }).parse(req.body);
    const result = await runExecutionAgent(req.params.id, campaignId, buildInput as any, req.user!, target);
    res.json({ ok: true, ...result });
  } catch (e) { next(e); }
});

// POST /orchestration/sessions/:id/qa
orchestrationRoutes.post('/sessions/:id/qa', async (req, res, next) => {
  try {
    const session = getSessionById(req.params.id);
    if (session.userId !== req.user!.id) throw new HttpError(403, 'Forbidden');
    const { campaignId, buildInput } = z.object({
      campaignId: z.string(),
      buildInput: buildInputSchema
    }).parse(req.body);
    const result = await runQaAgent(req.params.id, campaignId, buildInput as any, req.user!);
    res.json({ ok: true, ...result });
  } catch (e) { next(e); }
});

// POST /orchestration/sessions/:id/analyze
orchestrationRoutes.post('/sessions/:id/analyze', async (req, res, next) => {
  try {
    const session = getSessionById(req.params.id);
    if (session.userId !== req.user!.id) throw new HttpError(403, 'Forbidden');
    const analysisInput = z.object({
      source: z.enum(['meta', 'googleAds', 'ga4']),
      campaign: z.object({
        name: z.string(),
        objective: z.enum(['lead_generation', 'sales', 'traffic', 'awareness']),
        currency: z.string().length(3),
        manualMetrics: z.any().optional()
      }),
      externalCampaignId: z.string().optional()
    }).parse(req.body);
    const result = await runAnalysisAgentOnSession(req.params.id, analysisInput as any, req.user!, req.requestId);
    res.json({ ok: true, ...result });
  } catch (e) { next(e); }
});

// ── Approval ──────────────────────────────────────────────────────────────────

// POST /orchestration/sessions/:id/approve/:cardId
orchestrationRoutes.post('/sessions/:id/approve/:cardId', async (req, res, next) => {
  try {
    const session = getSessionById(req.params.id);
    if (session.userId !== req.user!.id) throw new HttpError(403, 'Forbidden');
    const { decision, modifiedPlan } = z.object({
      decision: z.enum(['approve', 'modify', 'reject']),
      modifiedPlan: z.string().optional()
    }).parse(req.body);
    const result = handleApprovalResponse(req.params.id, req.params.cardId, decision, modifiedPlan);
    res.json({ ok: true, ...result });
  } catch (e) { next(e); }
});

// ── Proactive suggestions ─────────────────────────────────────────────────────

// GET /orchestration/sessions/:id/suggestions
orchestrationRoutes.get('/sessions/:id/suggestions', async (req, res, next) => {
  try {
    const session = getSessionById(req.params.id);
    if (session.userId !== req.user!.id) throw new HttpError(403, 'Forbidden');
    const suggestions = getProactiveSuggestions(req.params.id);
    res.json({ ok: true, suggestions });
  } catch (e) { next(e); }
});

// ── Activity log ──────────────────────────────────────────────────────────────

// GET /orchestration/sessions/:id/activity
orchestrationRoutes.get('/sessions/:id/activity', async (req, res, next) => {
  try {
    const session = getSessionById(req.params.id);
    if (session.userId !== req.user!.id) throw new HttpError(403, 'Forbidden');
    const limit = Number(req.query['limit'] ?? 20);
    const log = session.activityLog.slice(-limit);
    res.json({ ok: true, log, total: session.activityLog.length });
  } catch (e) { next(e); }
});
