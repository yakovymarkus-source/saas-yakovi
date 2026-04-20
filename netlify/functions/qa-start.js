'use strict';
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const authHeader = event.headers['authorization'] || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };

  const supabaseAnon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  const { data: { user }, error: authErr } = await supabaseAnon.auth.getUser(token);
  if (authErr || !user) return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { executionReportId, researchReportId } = body;
  if (!executionReportId) return { statusCode: 400, body: JSON.stringify({ error: 'executionReportId required' }) };

  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  // Verify execution report ownership
  const { data: execReport, error: reportErr } = await db.from('execution_reports')
    .select('id, user_id').eq('id', executionReportId).single();
  if (reportErr || !execReport) return { statusCode: 404, body: JSON.stringify({ error: 'Execution report not found' }) };
  if (execReport.user_id !== user.id) return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden' }) };

  // Create QA job
  const { data: job, error: jobErr } = await db.from('qa_jobs').insert({
    user_id:             user.id,
    execution_report_id: executionReportId,
    research_report_id:  researchReportId || null,
    status:              'queued',
    started_at:          new Date().toISOString(),
  }).select('id').single();

  if (jobErr) return { statusCode: 500, body: JSON.stringify({ error: jobErr.message }) };

  // Fire-and-forget
  fetch(`${process.env.URL}/.netlify/functions/process-qa-job`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-secret': process.env.INTERNAL_SECRET || '' },
    body: JSON.stringify({ jobId: job.id }),
  }).catch(() => {});

  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jobId: job.id, status: 'queued' }),
  };
};
