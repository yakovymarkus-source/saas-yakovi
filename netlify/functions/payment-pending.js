'use strict';

/**
 * payment-pending.js
 *
 * Called by the frontend after the user completes a GrowLink payment.
 * Auto-activates the subscription immediately and notifies admin for verification.
 * Admin can manually deactivate if the payment turns out to be fraudulent.
 */

const { ok, fail, options }                     = require('./_shared/http');
const { createRequestContext, buildLogPayload }  = require('./_shared/observability');
const { writeRequestLog, getAdminClient }        = require('./_shared/supabase');
const { requireAuth }                           = require('./_shared/auth');
const { AppError }                              = require('./_shared/errors');
const { parseJsonBody }                         = require('./_shared/request');
const { validatePaymentPending }                = require('./_shared/validation');
const { writeAudit }                            = require('./_shared/audit');
const { sendAdminPaymentAlert, sendActivationEmail } = require('./_shared/email');
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

    // Auto-activate subscription immediately
    await sb.rpc('activate_payment', { p_user_id: user.id, p_plan: plan });

    await writeAudit({ userId: user.id, action: 'payment.self_activated', targetType: 'subscription', targetId: user.id, metadata: { plan }, ip: context.ip, requestId: context.requestId });

    // Fetch user profile + auth email for notifications
    const { data: profile } = await sb.from('profiles')
      .select('name, email')
      .eq('id', user.id)
      .maybeSingle();

    let userEmail = profile?.email;
    if (!userEmail) {
      const { data: authUser } = await sb.auth.admin.getUserById(user.id);
      userEmail = authUser?.user?.email || null;
    }

    // Send activation confirmation to user
    if (userEmail) {
      sendActivationEmail({ to: userEmail })
        .catch(e => console.warn('[payment-pending] user email failed:', e.message));
    }

    // Notify admin for verification
    const adminEmail = getEnv().ADMIN_EMAIL;
    if (adminEmail) {
      sendAdminPaymentAlert({
        adminEmail,
        userEmail: userEmail || user.id,
        userName:  profile?.name,
        plan,
      }).catch(e => console.warn('[payment-pending] admin alert failed:', e.message));
    }

    await writeRequestLog(buildLogPayload(context, 'info', 'payment_self_activated', {
      user_id: user.id, plan,
    }));

    return ok({ message: 'החשבון הופעל בהצלחה! ברוך הבא 🎉' }, context.requestId);
  } catch (error) {
    await writeRequestLog(buildLogPayload(context, 'error', 'payment_pending_failed', { code: error.code })).catch(() => {});
    return fail(error, context.requestId);
  }
};
