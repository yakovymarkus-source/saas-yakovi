'use strict';
require('./_shared/env');

const { ok, fail, options } = require('./_shared/http');
const { getAdminClient }    = require('./_shared/supabase');
const { runResearchPipeline } = require('./_shared/research/pipeline');

/**
 * POST /process-research-job
 * Internal endpoint — called by research-start (fire-and-forget).
 * Requires x-internal-secret header.
 * Runs the full pipeline synchronously (up to 26s netlify limit).
 * For deep research that takes longer, steps are saved to DB and polling continues.
 */
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options();
  if (event.httpMethod !== 'POST') return fail('METHOD_NOT_ALLOWED', 'POST only', 405);

  const secret = process.env.SYNC_JOB_INTERNAL_SECRET || '';
  if (secret && event.headers['x-internal-secret'] !== secret) {
    return fail('UNAUTHORIZED', 'invalid internal secret', 401);
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return fail('BAD_REQUEST', 'invalid JSON', 400); }

  const { jobId } = body;
  if (!jobId) return fail('BAD_REQUEST', 'jobId required', 400);

  const supabase = getAdminClient();

  // Load job
  const { data: job, error } = await supabase
    .from('research_jobs')
    .select('*')
    .eq('id', jobId)
    .single();

  if (error || !job) return fail('NOT_FOUND', 'job not found', 404);
  if (job.status === 'running' || job.status === 'completed') {
    return ok({ message: 'job already processed', status: job.status });
  }

  try {
    await runResearchPipeline({ job, supabase, onStep: null });
    return ok({ success: true, jobId });
  } catch (err) {
    console.error('[process-research-job] pipeline error:', err.message);
    return fail('PIPELINE_ERROR', err.message, 500);
  }
};
