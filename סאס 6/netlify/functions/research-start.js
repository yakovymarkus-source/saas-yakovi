'use strict';
require('./_shared/env');

const { ok, fail, options }  = require('./_shared/http');
const { requireAuth }        = require('./_shared/auth');
const { parseJsonBody }      = require('./_shared/request');
const { getAdminClient }     = require('./_shared/supabase');
const { getPlanByLevel }     = require('./_shared/research/planner');
const iLogger                = require('./_shared/intelligence-logger');

/**
 * POST /research-start
 * Body: { niche, depth_level, business_name?, target_audience?, main_offer? }
 * Returns: { jobId, estimatedMinutes, depthLabel, creditsRequired }
 *
 * Creates the research job and starts the pipeline as a background task.
 * Client polls /research-status?jobId=X for live progress.
 */
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options();
  if (event.httpMethod !== 'POST') return fail('METHOD_NOT_ALLOWED', 'POST only', 405);

  let user;
  try { user = await requireAuth(event); } catch (e) { return fail('UNAUTHORIZED', e.message, 401); }

  let body;
  try { body = parseJsonBody(event); } catch { return fail('BAD_REQUEST', 'invalid JSON', 400); }

  const { niche, depth_level = 'low', business_name, target_audience, main_offer } = body;
  if (!niche?.trim()) return fail('BAD_REQUEST', 'niche is required', 400);

  const depthLevels = ['low', 'medium', 'high'];
  if (!depthLevels.includes(depth_level)) return fail('BAD_REQUEST', 'depth_level must be low|medium|high', 400);

  const plan  = getPlanByLevel(depth_level);
  const supabase = getAdminClient();

  // Create the job
  const { data: job, error } = await supabase.from('research_jobs').insert({
    user_id:         user.id,
    status:          'queued',
    depth_level,
    niche:           niche.trim(),
    business_name:   business_name?.trim() || null,
    target_audience: target_audience?.trim() || null,
    main_offer:      main_offer?.trim() || null,
    max_competitors: plan.maxCompetitors,
    max_signals:     plan.maxSignals,
    max_ai_calls:    plan.maxAiCalls,
    estimated_minutes: plan.estimatedMinutes,
    credits_used:    0,
  }).select().single();

  if (error || !job) {
    console.error('[research-start] insert error:', error);
    return fail('DB_ERROR', 'Failed to create research job', 500);
  }

  // Kick off pipeline asynchronously (fire-and-forget via internal trigger)
  // The pipeline runs inside research-run.js triggered by process-research-job
  try {
    const baseUrl = process.env.APP_URL || 'https://campaignbrain.netlify.app';
    const secret  = process.env.SYNC_JOB_INTERNAL_SECRET || '';
    fetch(`${baseUrl}/.netlify/functions/process-research-job`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': secret },
      body:    JSON.stringify({ jobId: job.id }),
    }).catch(e => console.warn('[research-start] trigger warning:', e.message));
  } catch {}

  iLogger.log({ agent_name: 'research-agent', interaction_type: 'api_call', status: 'SUCCESS', user_id: user.id }).catch(() => {});
  return ok({
    jobId:            job.id,
    estimatedMinutes: plan.estimatedMinutes,
    depthLabel:       plan.label,
    creditsRequired:  plan.credits,
    message:          `מחקר ברמת "${plan.label}" מתחיל. צפוי לקחת כ-${plan.estimatedMinutes} דקות.`,
  });
};
