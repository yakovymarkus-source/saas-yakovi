'use strict';
const { createClient } = require('@supabase/supabase-js');
const { runExecutionPipeline } = require('./_shared/execution/pipeline');

exports.handler = async (event) => {
  // Internal-only endpoint
  const secret = process.env.INTERNAL_SECRET || '';
  if (event.headers['x-internal-secret'] !== secret) {
    return { statusCode: 403, body: 'Forbidden' };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  const { jobId } = body;
  if (!jobId) return { statusCode: 400, body: 'jobId required' };

  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  // Load job
  const { data: job, error: jobErr } = await db.from('execution_jobs')
    .select('id, user_id, strategy_report_id, status, execution_mode, platform, asset_types')
    .eq('id', jobId)
    .single();

  if (jobErr || !job) return { statusCode: 404, body: 'Job not found' };
  if (job.status !== 'queued') return { statusCode: 200, body: JSON.stringify({ skipped: true, status: job.status }) };

  // Mark running
  await db.from('execution_jobs').update({ status: 'running', started_at: new Date().toISOString() }).eq('id', jobId);

  // Load strategy report (full)
  const { data: strategyReport, error: srErr } = await db.from('strategy_reports')
    .select('*')
    .eq('id', job.strategy_report_id)
    .single();

  if (srErr || !strategyReport) {
    await db.from('execution_jobs').update({ status: 'failed', error_message: 'Strategy report not found' }).eq('id', jobId);
    return { statusCode: 404, body: 'Strategy report not found' };
  }

  try {
    const result = await runExecutionPipeline({
      jobId:          job.id,
      userId:         job.user_id,
      strategyReport,
      assetTypes:     job.asset_types || ['ads', 'hooks', 'cta'],
      executionMode:  job.execution_mode || 'smart',
      platform:       job.platform || 'meta',
    });

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(result),
    };
  } catch (err) {
    await db.from('execution_jobs').update({
      status:        'failed',
      error_message: err.message,
      completed_at:  new Date().toISOString(),
    }).eq('id', jobId);

    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
