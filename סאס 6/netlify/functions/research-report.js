'use strict';
require('./_shared/env');

const { ok, fail, options } = require('./_shared/http');
const { requireAuth }       = require('./_shared/auth');
const { getAdminClient }    = require('./_shared/supabase');

/**
 * GET /research-report?reportId=X  OR  ?jobId=X
 * Returns the full structured research report.
 */
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options();
  if (event.httpMethod !== 'GET')  return fail('METHOD_NOT_ALLOWED', 'GET only', 405);

  let user;
  try { user = await requireAuth(event); } catch (e) { return fail('UNAUTHORIZED', e.message, 401); }

  const { reportId, jobId } = event.queryStringParameters || {};
  if (!reportId && !jobId) return fail('BAD_REQUEST', 'reportId or jobId required', 400);

  const supabase = getAdminClient();
  let query = supabase.from('research_reports').select('*').eq('user_id', user.id);
  if (reportId) query = query.eq('id', reportId);
  else          query = query.eq('job_id', jobId);

  const { data: report, error } = await query.single();
  if (error || !report) return fail('NOT_FOUND', 'report not found', 404);

  // Mark cache as recently used
  if (report.niche) {
    const cacheKey = `${report.niche.toLowerCase().trim()}::${report.depth_level}`;
    getAdminClient().from('research_cache')
      .update({ last_used_at: new Date().toISOString() })
      .eq('cache_key', cacheKey)
      .then(() => {}).catch(() => {});
  }

  return ok({ report });
};
