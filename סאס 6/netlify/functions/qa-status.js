'use strict';
const { createClient } = require('@supabase/supabase-js');

const TOTAL_STEPS = 15;

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return { statusCode: 405, body: 'Method Not Allowed' };

  const { jobId, since = '0' } = event.queryStringParameters || {};
  if (!jobId) return { statusCode: 400, body: JSON.stringify({ error: 'jobId required' }) };

  const authHeader = event.headers['authorization'] || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };

  const supabaseAnon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  const { data: { user }, error: authErr } = await supabaseAnon.auth.getUser(token);
  if (authErr || !user) return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };

  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const { data: job, error: jobErr } = await db.from('qa_jobs')
    .select('id, status, verdict, overall_score, report_id, error_message, ai_calls_used, generation_ms')
    .eq('id', jobId).eq('user_id', user.id).single();

  if (jobErr || !job) return { statusCode: 404, body: JSON.stringify({ error: 'Job not found' }) };

  const { data: steps } = await db.from('qa_steps')
    .select('step_index, step_key, message, status, created_at')
    .eq('job_id', jobId)
    .gt('step_index', parseFloat(since))
    .order('step_index', { ascending: true });

  const doneSteps  = (steps || []).filter(s => s.status === 'done').length;
  const progress   = Math.min(100, Math.round((doneSteps / TOTAL_STEPS) * 100));

  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      status:       job.status,
      verdict:      job.verdict || null,
      overallScore: job.overall_score || null,
      reportId:     job.report_id || null,
      errorMessage: job.error_message || null,
      progress,
      steps:        steps || [],
    }),
  };
};
