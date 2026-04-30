'use strict';

const { ok, fail, options }                     = require('./_shared/http');
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
  if (event.httpMethod === 'OPTIONS') return options();
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
      getMrrSnapshot(sb).catch(() => ({ mrr: 0, breakdown: {}, activeCount: 0, trialingCount: 0 })),
      getMrrTrend(sb, 30).catch(() => []),
      getSignupTrend(sb, 30).catch(() => []),
      getChurnRate(sb).catch(() => ({ rate: 0 })),
      getConversionRate(sb).catch(() => ({ rate: 0 })),
      getNewSignups(sb, 24).catch(() => 0),
      getFailedPayments(sb, 24).catch(() => 0),
      getTotalUsers(sb).catch(() => 0),
      sb.from('sync_jobs').select('status').in('status', ['queued', 'running', 'failed']).catch(() => ({ data: [] })),
      sb.from('provider_health').select('*').catch(() => ({ data: [] })),
    ]);

    // Aggregate job stats
    const jobs = jobsRes?.data || [];
    const pendingJobs = jobs.filter(j => j.status === 'queued').length;
    const runningJobs = jobs.filter(j => j.status === 'running').length;
    const since24h    = new Date(Date.now() - 86400 * 1000).toISOString();
    const failedJobsRes = await sb.from('sync_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'failed').gte('updated_at', since24h).catch(() => ({ count: 0 }));
    const failedJobs24h = failedJobsRes?.count || 0;

    // Active alerts for notification badge
    const alerts = [];
    if (failedJobs24h > 0)        alerts.push({ type: 'jobs',     severity: 'high',    message: `${failedJobs24h} תהליכים כשלו ב-24 שעות האחרונות` });
    if (failedPayments24h > 0)    alerts.push({ type: 'billing',  severity: 'high',    message: `${failedPayments24h} תשלומים כושלים ב-24 שעות האחרונות` });
    if (pendingJobs > 10)         alerts.push({ type: 'queue',    severity: 'warning', message: `${pendingJobs} תהליכים ממתינים בתור` });

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
        providerHealth:  providerHealthRes?.data || [],
        pendingJobs,
        runningJobs,
        failedJobs24h,
      },
      alerts,
    }, context.requestId);
  } catch (error) {
    await writeRequestLog(buildLogPayload(context, 'error', 'admin_overview_failed', { code: error.code })).catch(() => {});
    return fail(error, context.requestId);
  }
};
