'use strict';

const { ok, fail }                              = require('./_shared/http');
const { createRequestContext, buildLogPayload }  = require('./_shared/observability');
const { writeRequestLog, getAdminClient }        = require('./_shared/supabase');
const { requireAdmin }                           = require('./_shared/admin-auth');
const { AppError }                               = require('./_shared/errors');
const {
  getMrrSnapshot, getMrrTrend, getSignupTrend,
  getChurnRate, getConversionRate,
  getNewSignups, getFailedPayments, getTotalUsers,
} = require('./_shared/admin-metrics');

exports.handler = async (event) => {
  const context = createRequestContext(event, 'admin-overview');
  try {
    if (event.httpMethod !== 'GET') {
      throw new AppError({ code: 'METHOD_NOT_ALLOWED', userMessage: 'Method not allowed', status: 405 });
    }
    await requireAdmin(event, context.functionName, context);

    const sb = getAdminClient();

    // All KPIs and trends in parallel
    const [
      mrrSnapshot,
      mrrTrend,
      signupTrend,
      churnRate,
      conversionRate,
      newSignups24h,
      failedPayments24h,
      totalUsers,
      jobsRes,
      providerHealthRes,
    ] = await Promise.all([
      getMrrSnapshot(sb),
      getMrrTrend(sb, 30),
      getSignupTrend(sb, 30),
      getChurnRate(sb),
      getConversionRate(sb),
      getNewSignups(sb, 24),
      getFailedPayments(sb, 24),
      getTotalUsers(sb),
      sb.from('sync_jobs').select('status').in('status', ['queued', 'running', 'failed']),
      sb.from('provider_health').select('*'),
    ]);

    // Aggregate job stats
    const jobs = jobsRes.data || [];
    const pendingJobs = jobs.filter(j => j.status === 'queued').length;
    const runningJobs = jobs.filter(j => j.status === 'running').length;
    const since24h    = new Date(Date.now() - 86400 * 1000).toISOString();
    const { count: failedJobs24h } = await sb.from('sync_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'failed').gte('updated_at', since24h);

    await writeRequestLog(buildLogPayload(context, 'info', 'admin_overview_read', {}));

    return ok({
      mrr:            mrrSnapshot.mrr,
      mrrBreakdown:   mrrSnapshot.breakdown,
      activeSubscriptions: mrrSnapshot.activeCount,
      trialSubscriptions:  mrrSnapshot.trialingCount,
      churnRate:      churnRate.rate,
      conversionRate: conversionRate.rate,
      totalUsers,
      newSignups24h,
      failedPayments24h,
      mrrTrend,
      signupTrend,
      systemHealth: {
        providerHealth:  providerHealthRes.data || [],
        pendingJobs,
        runningJobs,
        failedJobs24h: failedJobs24h || 0,
      },
    }, context.requestId);
  } catch (error) {
    await writeRequestLog(buildLogPayload(context, 'error', 'admin_overview_failed', { code: error.code })).catch(() => {});
    return fail(error, context.requestId);
  }
};
