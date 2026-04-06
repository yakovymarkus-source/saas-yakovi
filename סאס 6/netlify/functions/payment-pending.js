'use strict';

/**
 * payment-pending.js
 *
 * Called by the frontend after the user completes a manual GrowLink payment.
 * Sets subscription plan + payment_status='pending' so the admin can verify
 * and activate.  Does NOT grant plan access until admin calls activate-payment.
 */

const { ok, fail }                              = require('./_shared/http');
const { createRequestContext, buildLogPayload }  = require('./_shared/observability');
const { writeRequestLog, getAdminClient }        = require('./_shared/supabase');
const { requireAuth }                           = require('./_shared/auth');
const { AppError }                              = require('./_shared/errors');
const { parseJsonBody }                         = require('./_shared/request');
const { sendAdminPaymentAlert }                 = require('./_shared/email');

const VALID_PLANS = ['early_bird', 'pro'];

exports.handler = async (event) => {
  const context = createRequestContext(event, 'payment-pending');
  try {
    if (event.httpMethod !== 'POST') {
      throw new AppError({ code: 'METHOD_NOT_ALLOWED', userMessage: 'Method not allowed', status: 405 });
    }

    const user = await requireAuth(event, context.functionName, context);
    const body = parseJsonBody(event, { fallback: {}, allowEmpty: false });
    const plan = body.plan || 'early_bird';

    if (!VALID_PLANS.includes(plan)) {
      throw new AppError({ code: 'INVALID_INPUT', userMessage: 'תוכנית לא חוקית', status: 400 });
    }

    const sb = getAdminClient();

    // Upsert subscription with payment_status='pending'
    await sb.rpc('set_payment_pending', { p_user_id: user.id, p_plan: plan });

    // Fetch user profile for email
    const { data: profile } = await sb.from('profiles')
      .select('name, email')
      .eq('id', user.id)
      .maybeSingle();

    // Notify admin
    const adminEmail = process.env.ADMIN_EMAIL;
    if (adminEmail) {
      await sendAdminPaymentAlert({
        adminEmail,
        userEmail: profile?.email || user.email,
        userName:  profile?.name,
        plan,
      }).catch(e => console.warn('[payment-pending] admin alert failed:', e.message));
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
