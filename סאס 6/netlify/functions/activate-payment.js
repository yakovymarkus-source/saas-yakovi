'use strict';

/**
 * activate-payment.js  (admin only)
 *
 * POST { userId, plan }
 * Sets payment_status='verified', status='active' and sends the activation
 * welcome email to the user.
 */

const { ok, fail, options }                     = require('./_shared/http');
const { createRequestContext, buildLogPayload }  = require('./_shared/observability');
const { writeRequestLog, getAdminClient }        = require('./_shared/supabase');
const { requireAdmin }                          = require('./_shared/admin-auth');
const { AppError }                              = require('./_shared/errors');
const { parseJsonBody, requireField }           = require('./_shared/request');
const { isEnum }                                = require('./_shared/validation');
const { writeAudit }                            = require('./_shared/audit');
const { sendActivationEmail }                   = require('./_shared/email');
const { PLANS }                                 = require('./_shared/billing');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options();
  const context = createRequestContext(event, 'activate-payment');
  try {
    if (event.httpMethod !== 'POST') {
      throw new AppError({ code: 'METHOD_NOT_ALLOWED', userMessage: 'Method not allowed', status: 405 });
    }

    const admin = await requireAdmin(event, context.functionName, context);
    const body   = parseJsonBody(event, { fallback: {}, allowEmpty: false });
    const userId = requireField(body.userId, 'userId');
    const plan   = isEnum(body.plan || 'early_bird', 'plan', Object.keys(PLANS));

    const sb = getAdminClient();

    // Activate subscription — check for RPC-level errors
    const { error: rpcError } = await sb.rpc('activate_payment', { p_user_id: userId, p_plan: plan });
    if (rpcError) {
      console.error('[activate-payment] activate_payment RPC failed:', rpcError.message);
      throw new AppError({ code: 'PAYMENT_ACTIVATION_FAILED', userMessage: 'פעולת ההפעלה נכשלה', devMessage: `activate_payment RPC: ${rpcError.message}`, status: 500 });
    }

    // Verify subscription was actually updated
    const { data: updatedSub } = await sb.from('subscriptions').select('status,payment_status').eq('user_id', userId).maybeSingle();
    if (!updatedSub || updatedSub.payment_status !== 'verified') {
      console.error('[activate-payment] subscription row not updated after RPC — user_id:', userId);
      throw new AppError({ code: 'PAYMENT_VERIFICATION_FAILED', userMessage: 'לא ניתן לאמת את ההפעלה', devMessage: 'Subscription row not updated after RPC', status: 500 });
    }

    await writeAudit({ userId: admin.id, action: 'payment.activate', targetType: 'user', targetId: userId, metadata: { plan }, ip: context.ip, requestId: context.requestId });

    // Fetch user profile for email; fall back to auth.users if profile.email is null
    const { data: profile } = await sb.from('profiles')
      .select('name, email')
      .eq('id', userId)
      .maybeSingle();

    if (profile?.email) {
      await sendActivationEmail({
        to:        profile.email,
        name:      profile.name,
        planLabel: PLANS[plan]?.label || plan,
      }).catch(e => console.error('[activate-payment] activation email failed:', e.message));
    } else {
      console.error('[activate-payment] no email found for user:', userId, '— activation email not sent');
    }

    await writeRequestLog(buildLogPayload(context, 'info', 'payment_activated', {
      target_user_id: userId, plan,
    }));

    return ok({ message: 'החשבון הופעל בהצלחה.' }, context.requestId);
  } catch (error) {
    await writeRequestLog(buildLogPayload(context, 'error', 'activate_payment_failed', { code: error.code })).catch(() => {});
    return fail(error, context.requestId);
  }
};
