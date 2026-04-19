'use strict';
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return { statusCode: 405, body: 'Method Not Allowed' };

  const jobId = event.queryStringParameters?.jobId;
  const since = parseInt(event.queryStringParameters?.since || '0', 10);

  if (!jobId) return { statusCode: 400, body: JSON.stringify({ error: 'jobId required' }) };

  const authHeader = event.headers['authorization'] || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };

  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: { user }, error: authErr } = await createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY)
    .auth.getUser(token);
  if (authErr || !user) return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };

  // Get job (verify ownership)
  const { data: job, error: jobErr } = await db.from('execution_jobs')
    .select('id, status, report_id, error_message, execution_mode, platform, asset_types, created_at')
    .eq('id', jobId)
    .eq('user_id', user.id)
    .single();
  if (jobErr || !job) return { statusCode: 404, body: JSON.stringify({ error: 'Job not found' }) };

  // Get steps since index
  const { data: steps } = await db.from('execution_steps')
    .select('step_index, step_key, message, status, data, created_at')
    .eq('job_id', jobId)
    .gt('step_index', since)
    .order('step_index', { ascending: true });

  // Compute progress (18 total steps)
  const TOTAL_STEPS = 18;
  const { count: doneCount } = await db.from('execution_steps')
    .select('*', { count: 'exact', head: true })
    .eq('job_id', jobId)
    .eq('status', 'done');
  const progress = Math.min(100, Math.round(((doneCount || 0) / TOTAL_STEPS) * 100));

  // Extract QA status from last done step
  let qaStatus = null;
  const lastDoneWithData = (steps || []).filter(s => s.status === 'done' && s.data).pop();
  if (lastDoneWithData?.data?.qaStatus) qaStatus = lastDoneWithData.data.qaStatus;
  if (lastDoneWithData?.data?.status)   qaStatus = qaStatus || lastDoneWithData.data.status;

  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jobId,
      status:    job.status,
      reportId:  job.report_id || null,
      progress,
      steps:     steps || [],
      qaStatus,
      error:     job.error_message || null,
    }),
  };
};
