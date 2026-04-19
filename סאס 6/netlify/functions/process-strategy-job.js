'use strict';
require('./_shared/env');

const { ok, fail, options }      = require('./_shared/http');
const { getAdminClient }         = require('./_shared/supabase');
const { runStrategyPipeline }    = require('./_shared/strategy/pipeline');

/**
 * POST /process-strategy-job
 * Internal endpoint — called by strategy-start (fire-and-forget).
 * Requires x-internal-secret header.
 * Runs the full 20-module strategy pipeline (up to 26s Netlify limit).
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

  // Load strategy job
  const { data: job, error: jobErr } = await supabase
    .from('strategy_jobs')
    .select('*')
    .eq('id', jobId)
    .single();

  if (jobErr || !job) return fail('NOT_FOUND', 'strategy job not found', 404);
  if (job.status === 'running' || job.status === 'completed') {
    return ok({ message: 'job already processed', status: job.status });
  }

  // Load the linked research report
  const { data: researchReport, error: rErr } = await supabase
    .from('research_reports')
    .select('*')
    .eq('id', job.research_report_id)
    .single();

  if (rErr || !researchReport) {
    await supabase.from('strategy_jobs').update({
      status: 'failed',
      error_message: 'research report not found',
      completed_at: new Date().toISOString(),
    }).eq('id', jobId);
    return fail('NOT_FOUND', 'research report not found', 404);
  }

  try {
    await runStrategyPipeline({ job, researchReport, supabase });
    return ok({ success: true, jobId });
  } catch (err) {
    console.error('[process-strategy-job] pipeline error:', err.message);
    return fail('PIPELINE_ERROR', err.message, 500);
  }
};
