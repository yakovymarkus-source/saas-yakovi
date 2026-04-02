'use strict';

const { ok, fail }                              = require('./_shared/http');
const { createRequestContext, buildLogPayload }  = require('./_shared/observability');
const { writeRequestLog, getAdminClient }        = require('./_shared/supabase');
const { requireAdmin }                           = require('./_shared/admin-auth');
const { AppError }                               = require('./_shared/errors');

exports.handler = async (event) => {
  const context = createRequestContext(event, 'admin-system');
  try {
    if (event.httpMethod !== 'GET') {
      throw new AppError({ code: 'METHOD_NOT_ALLOWED', status: 405 });
    }
    await requireAdmin(event, context.functionName, context);

    const sb      = getAdminClient();
    const since1h = new Date(Date.now() - 3600 * 1000).toISOString();
    const since24h = new Date(Date.now() - 86400 * 1000).toISOString();

    const [
      providerHealthRes,
      pendingJobsRes,
      runningJobsRes,
      failedJobsRes,
      recentErrorsRes,
      totalReqsRes,
      errorReqsRes,
      avgDurationRes,
    ] = await Promise.all([
      sb.from('provider_health').select('*').order('updated_at', { ascending: false }),

      sb.from('sync_jobs').select('id', { count: 'exact', head: true }).eq('status', 'queued'),
      sb.from('sync_jobs').select('id', { count: 'exact', head: true }).eq('status', 'running'),

      sb.from('sync_jobs')
        .select('id, user_id, campaign_id, error_message, created_at, finished_at')
        .eq('status', 'failed')
        .gte('updated_at', since24h)
        .order('updated_at', { ascending: false })
        .limit(20),

      sb.from('request_logs')
        .select('function_name, message, metadata, created_at')
        .eq('level', 'error')
        .gte('created_at', since24h)
        .order('created_at', { ascending: false })
        .limit(30),

      // Error rate: total vs errors in last 1h
      sb.from('request_logs').select('id', { count: 'exact', head: true }).gte('created_at', since1h),
      sb.from('request_logs').select('id', { count: 'exact', head: true }).eq('level', 'error').gte('created_at', since1h),

      // Avg response time last 1h
      sb.from('request_logs').select('duration_ms').gte('created_at', since1h).not('duration_ms', 'is', null).limit(500),
    ]);

    const totalReqs    = totalReqsRes.count  || 0;
    const errorReqs    = errorReqsRes.count  || 0;
    const errorRate    = totalReqs > 0 ? Math.round((errorReqs / totalReqs) * 1000) / 1000 : 0;

    const durations    = (avgDurationRes.data || []).map(r => r.duration_ms).filter(Boolean);
    const avgDurationMs = durations.length
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : 0;

    await writeRequestLog(buildLogPayload(context, 'info', 'admin_system_read', {}));
    return ok({
      providerHealth:   providerHealthRes.data || [],
      syncJobs: {
        pending:        pendingJobsRes.count || 0,
        running:        runningJobsRes.count || 0,
        recentFailed:   failedJobsRes.data   || [],
      },
      requestMetrics: {
        errorRate1h:    errorRate,
        avgDurationMs,
        totalRequests1h: totalReqs,
        recentErrors:   recentErrorsRes.data || [],
      },
    }, context.requestId);
  } catch (error) {
    await writeRequestLog(buildLogPayload(context, 'error', 'admin_system_failed', { code: error.code })).catch(() => {});
    return fail(error, context.requestId);
  }
};
