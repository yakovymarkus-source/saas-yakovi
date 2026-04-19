'use strict';
require('./_shared/env');

const { ok, fail, options } = require('./_shared/http');
const { requireAuth }       = require('./_shared/auth');
const { parseJsonBody }     = require('./_shared/request');
const { getAdminClient }    = require('./_shared/supabase');

/**
 * POST /strategy-start
 * Body: { researchReportId, niche? }
 * Returns: { jobId, estimatedMinutes }
 *
 * Creates a strategy_jobs row and fires process-strategy-job asynchronously.
 * Client polls /strategy-status?jobId=X for live progress.
 */
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options();
  if (event.httpMethod !== 'POST') return fail('METHOD_NOT_ALLOWED', 'POST only', 405);

  let user;
  try { user = await requireAuth(event); } catch (e) { return fail('UNAUTHORIZED', e.message, 401); }

  let body;
  try { body = parseJsonBody(event); } catch { return fail('BAD_REQUEST', 'invalid JSON', 400); }

  const { researchReportId, niche } = body;
  if (!researchReportId?.trim()) return fail('BAD_REQUEST', 'researchReportId is required', 400);

  const supabase = getAdminClient();

  // Verify research report belongs to user
  const { data: report, error: rErr } = await supabase
    .from('research_reports')
    .select('id, niche')
    .eq('id', researchReportId)
    .eq('user_id', user.id)
    .single();

  if (rErr || !report) return fail('NOT_FOUND', 'research report not found', 404);

  const resolvedNiche = niche?.trim() || report.niche;

  // Create the strategy job
  const { data: job, error } = await supabase.from('strategy_jobs').insert({
    user_id:            user.id,
    research_report_id: researchReportId,
    niche:              resolvedNiche,
    status:             'queued',
    estimated_minutes:  2,
    credits_used:       0,
  }).select().single();

  if (error || !job) {
    console.error('[strategy-start] insert error:', error);
    return fail('DB_ERROR', 'Failed to create strategy job', 500);
  }

  // Fire pipeline asynchronously
  try {
    const baseUrl = process.env.APP_URL || 'https://campaignbrain.netlify.app';
    const secret  = process.env.SYNC_JOB_INTERNAL_SECRET || '';
    fetch(`${baseUrl}/.netlify/functions/process-strategy-job`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': secret },
      body:    JSON.stringify({ jobId: job.id }),
    }).catch(e => console.warn('[strategy-start] trigger warning:', e.message));
  } catch {}

  return ok({
    jobId:            job.id,
    estimatedMinutes: 2,
    niche:            resolvedNiche,
    message:          'בניית אסטרטגיה מתחילה. צפוי לקחת כ-2 דקות.',
  });
};
