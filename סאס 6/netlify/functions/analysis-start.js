'use strict';
const { createClient } = require('@supabase/supabase-js');
const iLogger = require('./_shared/intelligence-logger');

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

  const { campaignId, goal = 'leads', targets = {}, query = '' } = body;
  if (!campaignId) return { statusCode: 400, body: JSON.stringify({ error: 'campaignId required' }) };

  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const { data: job, error: jobErr } = await db.from('analysis_jobs').insert({
    user_id:     user.id,
    campaign_id: campaignId,
    goal,
    targets,
    query,
    status:      'pending',
  }).select('id').single();

  if (jobErr) return { statusCode: 500, body: JSON.stringify({ error: jobErr.message }) };

  // Fire-and-forget
  const baseUrl = process.env.URL || `https://${event.headers.host}`;
  fetch(`${baseUrl}/.netlify/functions/process-analysis-job`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.INTERNAL_SECRET || '' },
    body:    JSON.stringify({ jobId: job.id }),
  }).catch(e => console.error('[analysis-start] fire-and-forget failed:', e.message));

  iLogger.log({ agent_name: 'analysis-agent', interaction_type: 'api_call', status: 'SUCCESS', user_id: user.id }).catch(() => {});
  return {
    statusCode: 202,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jobId: job.id, status: 'pending' }),
  };
};
