'use strict';
/**
 * orchestrate-start.js
 * POST /orchestrate-start
 * Headers: Authorization: Bearer <supabase-jwt>
 * Body: { campaignId, action, campaignData?, analysisData?, goal?, automationLevel? }
 *
 * Creates an orchestration_jobs record and fires the background function.
 * Returns { jobId, status: 'pending' }.
 */
require('./_shared/env');

const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const authHeader = event.headers['authorization'] || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };

  const supabaseAnon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  const { data: { user }, error: authErr } = await supabaseAnon.auth.getUser(token);
  if (authErr || !user) return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { campaignId, action = 'research', campaignData, analysisData, goal, automationLevel } = body;
  if (!campaignId) return { statusCode: 400, body: JSON.stringify({ error: 'campaignId required' }) };
  if (!action) return { statusCode: 400, body: JSON.stringify({ error: 'action required' }) };

  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const { data: job, error: jobErr } = await db
    .from('orchestration_jobs')
    .insert({
      user_id: user.id,
      user_email: user.email,
      campaign_id: campaignId,
      action,
      campaign_data: campaignData || null,
      analysis_data: analysisData || null,
      goal: goal || null,
      automation_level: automationLevel || 'semi',
      status: 'pending',
    })
    .select('id')
    .single();

  if (jobErr) {
    console.error('[orchestrate-start] DB error:', jobErr.message);
    return { statusCode: 500, body: JSON.stringify({ error: jobErr.message }) };
  }

  // Fire background function
  const baseUrl = process.env.URL || `https://${event.headers.host}`;
  fetch(`${baseUrl}/.netlify/functions/analyze-campaign-background`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-secret': process.env.SYNC_JOB_INTERNAL_SECRET || '',
    },
    body: JSON.stringify({ jobId: job.id }),
  }).catch(e => console.error('[orchestrate-start] fire failed:', e.message));

  return {
    statusCode: 202,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jobId: job.id, status: 'pending' }),
  };
};
