'use strict';
const { createClient }      = require('@supabase/supabase-js');
const { runAnalysisPipeline } = require('./_shared/analysis/pipeline');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const secret = event.headers['x-internal-secret'] || '';
  if (secret !== (process.env.INTERNAL_SECRET || '')) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { jobId } = body;
  if (!jobId) return { statusCode: 400, body: JSON.stringify({ error: 'jobId required' }) };

  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const { data: job, error: jobErr } = await db.from('analysis_jobs')
    .select('*').eq('id', jobId).single();

  if (jobErr || !job) return { statusCode: 404, body: JSON.stringify({ error: 'Job not found' }) };
  if (job.status !== 'pending') return { statusCode: 200, body: JSON.stringify({ skipped: true }) };

  await db.from('analysis_jobs').update({ status: 'running' }).eq('id', jobId);

  try {
    const result = await runAnalysisPipeline({
      jobId,
      userId:     job.user_id,
      campaignId: job.campaign_id,
      goal:       job.goal || 'leads',
      targets:    job.targets || {},
      query:      job.query || '',
    });

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok: true, reportId: result.reportId, scores: result.scores }),
    };
  } catch (err) {
    console.error('[process-analysis-job] Pipeline error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
