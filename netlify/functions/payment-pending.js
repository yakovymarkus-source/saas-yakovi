'use strict';

/**
 * payment-pending.js
 *
 * Called by the frontend after the user completes a manual GrowLink payment.
 * Sets subscription plan + payment_status='pending' so the admin can verify
 * and activate.  Does NOT grant plan access until admin calls activate-payment.
 */

const { ok, fail, options }                     = require('./_shared/http');
const { createRequestContext, buildLogPayload }  = require('./_shared/observability');
const { writeRequestLog, getAdminClient }        = require('./_shared/supabase');
const { requireAuth }                           = require('./_shared/auth');
const { AppError }                              = require('./_shared/errors');
const { parseJsonBody }                         = require('./_shared/request');
const { validatePaymentPending }                = require('./_shared/validation');
const { writeAudit }                            = require('./_shared/audit');
const { sendAdminPaymentAlert }                 = require('./_shared/email');
const { getEnv }                                = require('./_shared/env');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options();
  const context = createRequestContext(event, 'payment-pending');
  try {
    if (event.httpMethod !== 'POST') {
      throw new AppError({ code: 'METHOD_NOT_ALLOWED', userMessage: 'Method not allowed', status: 405 });
    }

    const user           = await requireAuth(event, context.functionName, context);
    const body           = parseJsonBody(event, { fallback: {}, allowEmpty: false });
    const { plan }       = validatePaymentPending(body);

    const sb = getAdminClient();

    // Upsert subscription with payment_status='pending'
    const { error: rpcError } = await sb.rpc('set_payment_pending', { p_user_id: user.id, p_plan: plan });
    if (rpcError) {
      console.error('[payment-pending] set_payment_pending RPC failed:', rpcError.message);
      throw new AppError({ code: 'DB_WRITE_FAILED', userMessage: 'שגיאה בעדכון המנוי', devMessage: `set_payment_pending RPC: ${rpcError.message}`, status: 500 });
    }

    await writeAudit({ userId: user.id, action: 'payment.pending', targetType: 'subscription', targetId: user.id, metadata: { plan }, ip: context.ip, requestId: context.requestId });

    // Fetch user profile for email
    const { data: profile } = await sb.from('profiles')
      .select('name, email')
      .eq('id', user.id)
      .maybeSingle();

    // Notify admin
    const adminEmail = getEnv().ADMIN_EMAIL;
    if (!adminEmail) {
      console.error('[payment-pending] ADMIN_EMAIL not configured — admin will NOT receive payment notification. Set ADMIN_EMAIL in Netlify environment variables.');
    } else {
      await sendAdminPaymentAlert({
        adminEmail,
        userEmail: profile?.email || user.email,
        userName:  profile?.name,
        plan,
      }).catch(e => console.error('[payment-pending] admin alert email failed:', e.message));
    }

    await writeRequestLog(buildLogPayload(context, 'info', 'payment_pending_set', {
      user_id: user.id, plan,
    }));

    return ok({ message: 'הבקשה התקבלה! החשבון יופעל תוך דקות לאחר אישור התשלום.' }, context.requestId);
  } catch (error) {
    await writeRequestLog(buildLogPayload(context, 'error', 'payment_pending_failed', { code: error.code })).catch(() => {});
    return fail(error, context.requestId);
  }
};
