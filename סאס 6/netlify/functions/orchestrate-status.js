'use strict';
/**
 * orchestrate-status.js
 * GET /orchestrate-status?jobId=<id>
 * Headers: Authorization: Bearer <supabase-jwt>
 *
 * Returns job status + result when completed.
 */
require('./_shared/env');

const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, body: 'Method Not Allowed' };

  const authHeader = event.headers['authorization'] || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };

  const supabaseAnon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  const { data: { user }, error: authErr } = await supabaseAnon.auth.getUser(token);
  if (authErr || !user) return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };

  const jobId = event.queryStringParameters?.jobId;
  if (!jobId) return { statusCode: 400, body: JSON.stringify({ error: 'jobId required' }) };

  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const { data: job, error: jobErr } = await db
    .from('orchestration_jobs')
    .select('id, status, action, result, error_message, created_at, started_at, finished_at')
    .eq('id', jobId)
    .eq('user_id', user.id)
    .single();

  if (jobErr || !job) return { statusCode: 404, body: JSON.stringify({ error: 'Job not found' }) };

  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jobId: job.id,
      status: job.status,
      action: job.action,
      result: job.result || null,
      error: job.error_message || null,
      createdAt: job.created_at,
      startedAt: job.started_at,
      finishedAt: job.finished_at,
    }),
  };
};
