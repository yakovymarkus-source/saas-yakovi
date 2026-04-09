'use strict';

const { ok, fail }                              = require('./_shared/http');
const { createRequestContext, buildLogPayload }  = require('./_shared/observability');
const { writeRequestLog, getAdminClient }        = require('./_shared/supabase');
const { requireAdmin }                           = require('./_shared/admin-auth');
const { writeAudit }                             = require('./_shared/audit');
const { AppError }                               = require('./_shared/errors');
const { parseJsonBody, requireField }            = require('./_shared/request');

exports.handler = async (event) => {
  const context = createRequestContext(event, 'admin-user');
  try {
    const admin = await requireAdmin(event, context.functionName, context);
    const sb    = getAdminClient();

    // ── GET — full user detail ───────────────────────────────────────────────
    if (event.httpMethod === 'GET') {
      const userId = event.queryStringParameters?.userId;
      if (!userId) throw new AppError({ code: 'BAD_REQUEST', userMessage: 'userId required', status: 400 });

      const since30d = new Date(Date.now() - 30 * 86400 * 1000).toISOString();

      const [profileRes, subRes, campsRes, auditRes, paymentsRes, usageRes] = await Promise.all([
        sb.from('profiles').select('*').eq('id', userId).maybeSingle(),
        sb.from('subscriptions').select('*').eq('user_id', userId).maybeSingle(),
        sb.from('campaigns').select('id, name, created_at').eq('owner_user_id', userId).order('created_at', { ascending: false }).limit(20),
        sb.from('audit_log').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(20),
        sb.from('payment_events').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(10),
        sb.from('usage_events').select('event_name', { count: 'exact' }).eq('user_id', userId).gte('created_at', since30d),
      ]);

      if (!profileRes.data) throw new AppError({ code: 'NOT_FOUND', userMessage: 'User not found', status: 404 });

      // Count analysis runs separately
      const { count: analysisRuns30d } = await sb.from('analysis_results')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId).gte('created_at', since30d);

      return ok({
        profile:       profileRes.data,
        subscription:  subRes.data   || null,
        campaigns:     campsRes.data || [],
        recentAuditLog: auditRes.data || [],
        paymentEvents: paymentsRes.data || [],
        usageStats: {
          eventsLast30d:    usageRes.count    || 0,
          analysisRuns30d:  analysisRuns30d   || 0,
        },
      }, context.requestId);
    }

    // ── POST — operator actions ──────────────────────────────────────────────
    if (event.httpMethod === 'POST') {
      const body     = parseJsonBody(event, { fallback: {}, allowEmpty: false });
      const action   = requireField(body.action,   'action');
      const targetId = requireField(body.targetUserId, 'targetUserId');

      if (action === 'toggle_admin') {
        if (targetId === admin.id) {
          throw new AppError({ code: 'FORBIDDEN', userMessage: 'Cannot modify your own admin status', status: 403 });
        }
        const { data: current } = await sb.from('profiles').select('is_admin, email').eq('id', targetId).maybeSingle();
        if (!current) throw new AppError({ code: 'NOT_FOUND', userMessage: 'User not found', status: 404 });

        const newValue = !current.is_admin;
        await sb.from('profiles').update({ is_admin: newValue }).eq('id', targetId);
        await writeAudit({
          userId: admin.id,
          action: newValue ? 'admin.grant_admin' : 'admin.revoke_admin',
          targetId,
          targetType: 'user',
          metadata: { targetEmail: current.email, performedBy: admin.id },
          ip: context.ip, requestId: context.requestId,
        });
        await writeRequestLog(buildLogPayload(context, 'info', 'admin_toggle_admin', { targetId, newValue }));
        return ok({ targetUserId: targetId, isAdmin: newValue }, context.requestId);
      }

      if (action === 'cancel_subscription') {
        const { data: sub } = await sb.from('subscriptions')
          .select('stripe_sub_id, plan, status')
          .eq('user_id', targetId).maybeSingle();
        if (!sub?.stripe_sub_id) {
          throw new AppError({ code: 'NOT_FOUND', userMessage: 'No active Stripe subscription found', status: 404 });
        }
        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
        await stripe.subscriptions.cancel(sub.stripe_sub_id, { prorate: true });
        await sb.from('subscriptions').update({ status: 'canceled', updated_at: new Date().toISOString() }).eq('user_id', targetId);
        await writeAudit({
          userId: admin.id, action: 'admin.cancel_subscription',
          targetId, targetType: 'user',
          metadata: { plan: sub.plan, stripeSubId: sub.stripe_sub_id, performedBy: admin.id },
          ip: context.ip, requestId: context.requestId,
        });
        await writeRequestLog(buildLogPayload(context, 'info', 'admin_cancel_subscription', { targetId }));
        return ok({ targetUserId: targetId, status: 'canceled' }, context.requestId);
      }

      throw new AppError({ code: 'BAD_REQUEST', userMessage: `Unknown action: ${action}`, status: 400 });
    }

    throw new AppError({ code: 'METHOD_NOT_ALLOWED', status: 405 });
  } catch (error) {
    await writeRequestLog(buildLogPayload(context, 'error', 'admin_user_failed', { code: error.code })).catch(() => {});
    return fail(error, context.requestId);
  }
};
