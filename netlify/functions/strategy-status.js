'use strict';
require('./_shared/env');

const { ok, fail, options } = require('./_shared/http');
const { requireAuth }       = require('./_shared/auth');
const { getAdminClient }    = require('./_shared/supabase');

/**
 * GET /strategy-status?jobId=X&since=Y
 * Returns current job status + steps since step_index Y.
 * Client polls every 2.5s. Renders live progress stream.
 *
 * Response:
 * {
 *   status: 'queued'|'running'|'completed'|'failed',
 *   progress: 0-100,
 *   steps: [{step_index, step_key, message, status, created_at}],
 *   reportId: string|null,
 *   goSignal: 'ירוק'|'צהוב'|'אדום'|null,
 *   error: string|null,
 * }
 */
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options();
  if (event.httpMethod !== 'GET') return fail('METHOD_NOT_ALLOWED', 'GET only', 405);

  let user;
  try { user = await requireAuth(event); } catch (e) { return fail('UNAUTHORIZED', e.message, 401); }

  const { jobId, since = '0' } = event.queryStringParameters || {};
  if (!jobId) return fail('BAD_REQUEST', 'jobId required', 400);

  const supabase = getAdminClient();

  const { data: job, error } = await supabase
    .from('strategy_jobs')
    .select('id, status, niche, research_report_id, report_id, error_message, created_at, started_at, completed_at')
    .eq('id', jobId)
    .eq('user_id', user.id)
    .single();

  if (error || !job) return fail('NOT_FOUND', 'job not found', 404);

  const sinceIndex = parseInt(since, 10) || 0;
  const { data: steps } = await supabase
    .from('strategy_steps')
    .select('step_index, step_key, message, status, created_at, data')
    .eq('job_id', jobId)
    .gt('step_index', sinceIndex)
    .order('step_index', { ascending: true });

  const stepCount = (steps?.length || 0) + sinceIndex;
  let progress = 0;
  if (job.status === 'queued')      progress = 2;
  else if (job.status === 'running') progress = Math.min(92, Math.round((stepCount / 20) * 100));
  else if (job.status === 'completed') progress = 100;

  // Extract go_signal from latest step data if available
  let goSignal = null;
  const lastStep = steps?.slice(-1)[0];
  if (lastStep?.data?.go_signal) goSignal = lastStep.data.go_signal;

  return ok({
    status:      job.status,
    progress,
    niche:       job.niche,
    steps:       steps || [],
    reportId:    job.report_id || null,
    goSignal,
    error:       job.error_message || null,
    startedAt:   job.started_at,
    completedAt: job.completed_at,
  });
};
