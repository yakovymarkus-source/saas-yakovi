'use strict';
const { createClient } = require('@supabase/supabase-js');
const { runQaPipeline } = require('./_shared/qa/pipeline');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const secret = event.headers['x-internal-secret'] || '';
  if (secret !== (process.env.INTERNAL_SECRET || '')) return { statusCode: 401, body: 'Unauthorized' };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  const { jobId } = body;
  if (!jobId) return { statusCode: 400, body: 'jobId required' };

  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const { data: job, error: jobErr } = await db.from('qa_jobs')
    .select('id, user_id, execution_report_id, research_report_id')
    .eq('id', jobId).single();

  if (jobErr || !job) return { statusCode: 404, body: 'Job not found' };

  await db.from('qa_jobs').update({ status: 'running', started_at: new Date().toISOString() }).eq('id', jobId);

  // Load execution report
  const { data: execReport, error: execErr } = await db.from('execution_reports')
    .select('*').eq('id', job.execution_report_id).single();
  if (execErr || !execReport) {
    await db.from('qa_jobs').update({ status: 'failed', error_message: 'Execution report not found' }).eq('id', jobId);
    return { statusCode: 404, body: 'Execution report not found' };
  }

  // Load research report (optional)
  let researchReport = null;
  if (job.research_report_id) {
    const { data } = await db.from('research_reports').select('*').eq('id', job.research_report_id).single();
    researchReport = data || null;
  }

  try {
    const result = await runQaPipeline({
      jobId, userId: job.user_id, executionReport: execReport, researchReport,
    });
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(result),
    };
  } catch (err) {
    await db.from('qa_jobs').update({ status: 'failed', error_message: err.message }).eq('id', jobId);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
