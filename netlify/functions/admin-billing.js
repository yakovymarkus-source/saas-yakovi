'use strict';

const { ok, fail, options }                     = require('./_shared/http');
const { createRequestContext, buildLogPayload }  = require('./_shared/observability');
const { writeRequestLog, getAdminClient }        = require('./_shared/supabase');
const { requireAdmin }                           = require('./_shared/admin-auth');
const { AppError }                               = require('./_shared/errors');
const { getMrrSnapshot, getMrrTrend, PLAN_PRICES }= require('./_shared/admin-metrics');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options();
  const context = createRequestContext(event, 'admin-billing');
  try {
    if (event.httpMethod !== 'GET') {
      throw new AppError({ code: 'METHOD_NOT_ALLOWED', status: 405 });
    }
    await requireAdmin(event, context.functionName, context);

    const sb   = getAdminClient();
    const days = Math.min(365, parseInt(event.queryStringParameters?.days || '30', 10));
    const since = new Date(Date.now() - days * 86400 * 1000).toISOString();
    const since24h = new Date(Date.now() - 86400 * 1000).toISOString();

    const [mrrSnapshot, mrrTrend, recentPayments, failedPayments, churnedSubs, revenueToday] =
      await Promise.all([
        getMrrSnapshot(sb),
        getMrrTrend(sb, days),

        sb.from('payment_events')
          .select('*, profiles!payment_events_user_id_fkey(email, name)')
          .order('created_at', { ascending: false })
          .limit(50),

        sb.from('payment_events')
          .select('*, profiles!payment_events_user_id_fkey(email)')
          .eq('event_type', 'payment_failed')
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(50),

        sb.from('subscriptions')
          .select('user_id, plan, status, updated_at, profiles!subscriptions_user_id_fkey(email, name)')
          .eq('status', 'canceled')
          .gte('updated_at', since)
          .order('updated_at', { ascending: false })
          .limit(50),

        sb.from('payment_events')
          .select('amount_cents')
          .eq('event_type', 'payment_succeeded')
          .gte('created_at', since24h),
      ]);

    const todayRevenueCents = (revenueToday.data || []).reduce((s, r) => s + r.amount_cents, 0);

    // Revenue breakdown by plan from payment_events in window
    const { data: planRevData } = await sb.from('payment_events')
      .select('plan, amount_cents')
      .eq('event_type', 'payment_succeeded')
      .gte('created_at', since);

    const revenueByPlan = (planRevData || []).reduce((m, r) => {
      if (r.plan) m[r.plan] = (m[r.plan] || 0) + r.amount_cents;
      return m;
    }, {});

    await writeRequestLog(buildLogPayload(context, 'info', 'admin_billing_read', { days }));
    return ok({
      mrr:             mrrSnapshot.mrr,
      arr:             mrrSnapshot.mrr * 12,
      mrrBreakdown:    mrrSnapshot.breakdown,
      activeSubscriptions: mrrSnapshot.activeCount,
      trialSubscriptions:  mrrSnapshot.trialingCount,
      todayRevenueCents,
      revenueByPlan,
      mrrTrend,
      recentPaymentEvents: recentPayments.data  || [],
      failedPayments:      failedPayments.data  || [],
      churnedSubscriptions:churnedSubs.data     || [],
    }, context.requestId);
  } catch (error) {
    await writeRequestLog(buildLogPayload(context, 'error', 'admin_billing_failed', { code: error.code })).catch(() => {});
    return fail(error, context.requestId);
  }
};
