'use strict';
require('./_shared/env');

const { ok, fail, options } = require('./_shared/http');
const { requireAuth }       = require('./_shared/auth');
const { getAdminClient }    = require('./_shared/supabase');

/**
 * GET /research-status?jobId=X&since=Y
 * Returns current job status + steps since step_index Y.
 * Client polls every 2s. Renders live progress stream.
 *
 * Response:
 * {
 *   status: 'queued'|'running'|'completed'|'failed',
 *   progress: 0-100,
 *   steps: [{step_index, step_key, message, status, created_at}],
 *   reportId: string|null,
 *   error: string|null,
 * }
 */
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options();
  if (event.httpMethod !== 'GET')  return fail('METHOD_NOT_ALLOWED', 'GET only', 405);

  let user;
  try { user = await requireAuth(event); } catch (e) { return fail('UNAUTHORIZED', e.message, 401); }

  const { jobId, since = '0' } = event.queryStringParameters || {};
  if (!jobId) return fail('BAD_REQUEST', 'jobId required', 400);

  const supabase = getAdminClient();

  // Load job (must belong to user)
  const { data: job, error } = await supabase
    .from('research_jobs')
    .select('id, status, depth_level, niche, estimated_minutes, report_id, error_message, created_at, started_at, completed_at')
    .eq('id', jobId)
    .eq('user_id', user.id)
    .single();

  if (error || !job) return fail('NOT_FOUND', 'job not found', 404);

  // Load new steps since last poll
  const sinceIndex = parseInt(since, 10) || 0;
  const { data: steps } = await supabase
    .from('research_steps')
    .select('step_index, step_key, message, status, created_at, data')
    .eq('job_id', jobId)
    .gt('step_index', sinceIndex)
    .order('step_index', { ascending: true });

  // Estimate progress based on status + step count
  const stepCount = (steps?.length || 0) + sinceIndex;
  let progress = 0;
  if (job.status === 'queued')    progress = 2;
  else if (job.status === 'running') {
    const totalSteps = { low: 18, medium: 24, high: 32 }[job.depth_level] || 20;
    progress = Math.min(92, Math.round((stepCount / totalSteps) * 100));
  } else if (job.status === 'completed') progress = 100;
  else if (job.status === 'failed')     progress = 0;

  return ok({
    status:    job.status,
    progress,
    niche:     job.niche,
    depthLevel: job.depth_level,
    steps:     steps || [],
    reportId:  job.report_id || null,
    error:     job.error_message || null,
    startedAt: job.started_at,
    completedAt: job.completed_at,
  });
};
