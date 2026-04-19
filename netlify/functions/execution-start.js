'use strict';
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { strategyReportId, assetTypes, executionMode, platform } = body;
  if (!strategyReportId) return { statusCode: 400, body: JSON.stringify({ error: 'strategyReportId required' }) };

  // Auth
  const authHeader = event.headers['authorization'] || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };

  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  // Verify token + get user
  const { data: { user }, error: authErr } = await createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY)
    .auth.getUser(token);
  if (authErr || !user) return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };

  // Verify strategy report belongs to user
  const { data: stratReport, error: srErr } = await db
    .from('strategy_reports')
    .select('id, niche, confidence, go_signal')
    .eq('id', strategyReportId)
    .eq('user_id', user.id)
    .single();
  if (srErr || !stratReport) return { statusCode: 404, body: JSON.stringify({ error: 'Strategy report not found' }) };

  // Create execution job
  const { data: job, error: jobErr } = await db.from('execution_jobs').insert({
    user_id:            user.id,
    strategy_report_id: strategyReportId,
    status:             'queued',
    execution_mode:     executionMode || 'smart',
    platform:           platform || 'meta',
    asset_types:        assetTypes || ['ads', 'hooks', 'cta'],
    estimated_minutes:  executionMode === 'premium' ? 3 : 2,
    credits_used:       _creditsForMode(executionMode || 'smart'),
  }).select('id').single();

  if (jobErr) return { statusCode: 500, body: JSON.stringify({ error: jobErr.message }) };

  // Fire-and-forget: trigger process-execution-job
  const secret = process.env.INTERNAL_SECRET || '';
  const baseUrl = process.env.URL || `https://${event.headers.host}`;
  fetch(`${baseUrl}/.netlify/functions/process-execution-job`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-secret': secret },
    body: JSON.stringify({ jobId: job.id }),
  }).catch(() => {});

  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jobId: job.id, status: 'queued' }),
  };
};

function _creditsForMode(mode) {
  return mode === 'premium' ? 5 : mode === 'smart' ? 3 : 1;
}
