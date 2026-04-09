const { ok, fail }                            = require('./_shared/http');
const { createRequestContext, buildLogPayload } = require('./_shared/observability');
const { writeRequestLog }                       = require('./_shared/supabase');
const { requireAuth }                           = require('./_shared/auth');
const { createPortalSession }                   = require('./_shared/billing');
const { AppError }                              = require('./_shared/errors');
const { getEnv }                                = require('./_shared/env');

exports.handler = async (event) => {
  const context = createRequestContext(event, 'billing-portal');
  try {
    if (event.httpMethod !== 'POST') {
      throw new AppError({ code: 'METHOD_NOT_ALLOWED', userMessage: 'Method not allowed', devMessage: 'Unsupported method', status: 405 });
    }

    const user    = await requireAuth(event, context.functionName, context);
    const env     = getEnv();
    const { url } = await createPortalSession({
      userId:    user.id,
      returnUrl: `${env.APP_URL}/settings/billing`,
    });

    await writeRequestLog(buildLogPayload(context, 'info', 'billing_portal_created', { user_id: user.id }));
    return ok({ url }, context.requestId);
  } catch (error) {
    await writeRequestLog(buildLogPayload(context, 'error', error.message || 'billing_portal_failed', { code: error.code || 'INTERNAL_ERROR' })).catch(() => {});
    return fail(error, context.requestId);
  }
};
