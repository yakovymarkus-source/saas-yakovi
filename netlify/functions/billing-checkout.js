const { ok, fail, options }                    = require('./_shared/http');
const { createRequestContext, buildLogPayload }  = require('./_shared/observability');
const { writeRequestLog }                        = require('./_shared/supabase');
const { requireAuth }                            = require('./_shared/auth');
const { createCheckoutSession }                  = require('./_shared/payments');
const { AppError }                               = require('./_shared/errors');
const { parseJsonBody }                          = require('./_shared/request');
const { getEnv }                                 = require('./_shared/env');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options();
  const context = createRequestContext(event, 'billing-checkout');
  try {
    if (event.httpMethod !== 'POST') {
      throw new AppError({ code: 'METHOD_NOT_ALLOWED', userMessage: 'Method not allowed', devMessage: 'Unsupported method', status: 405 });
    }

    const user   = await requireAuth(event, context.functionName, context);
    const body   = parseJsonBody(event, { fallback: {}, allowEmpty: false, devMessage: 'Invalid JSON in billing-checkout' });
    const env    = getEnv();
    const appUrl = env.APP_URL;

    // planId is used by Grow (link-based). priceId is used by Stripe.
    const planId  = body.planId  || null;
    const priceId = body.priceId || null;

    const result = await createCheckoutSession({
      userId:     user.id,
      email:      user.email,
      planId,
      priceId,
      successUrl: `${appUrl}/settings/billing?success=1`,
      cancelUrl:  `${appUrl}/settings/billing?canceled=1`,
    });

    await writeRequestLog(buildLogPayload(context, 'info', 'billing_checkout_created', {
      user_id: user.id, plan_id: planId, price_id: priceId, provider: result.provider,
    }));

    return ok(result, context.requestId);
  } catch (error) {
    await writeRequestLog(buildLogPayload(context, 'error', error.message || 'billing_checkout_failed', { code: error.code || 'INTERNAL_ERROR' })).catch(() => {});
    return fail(error, context.requestId);
  }
};
