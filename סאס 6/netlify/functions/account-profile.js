const { ok, fail } = require('./_shared/http');
const { createRequestContext, buildLogPayload } = require('./_shared/observability');
const { writeRequestLog } = require('./_shared/supabase');
const { requireAuth } = require('./_shared/auth');
const { getProfile, updateProfile } = require('./_shared/account');
const { parseJsonBody } = require('./_shared/request');

exports.handler = async (event) => {
  const context = createRequestContext(event, 'account-profile');
  try {
    const user = await requireAuth(event, context.functionName, context);
    if (event.httpMethod === 'GET') {
      const profile = await getProfile(user.id);
      await writeRequestLog(buildLogPayload(context, 'info', 'account_profile_read', { user_id: user.id }));
      return ok(profile, context.requestId, { 'X-Correlation-Id': context.correlationId });
    }
    if (event.httpMethod === 'PUT') {
      const payload = parseJsonBody(event, { fallback: {}, allowEmpty: true, devMessage: 'Invalid JSON in account-profile body' });
      const profile = await updateProfile(user, payload);
      await writeRequestLog(buildLogPayload(context, 'info', 'account_profile_updated', { user_id: user.id }));
      return ok(profile, context.requestId, { 'X-Correlation-Id': context.correlationId });
    }
    return fail({ code: 'METHOD_NOT_ALLOWED', userMessage: 'Method not allowed', devMessage: 'Unsupported method', status: 405 }, context.requestId);
  } catch (error) {
    await writeRequestLog(buildLogPayload(context, 'error', error.message || 'account_profile_failed', { code: error.code || 'INTERNAL_ERROR' })).catch(() => {});
    return fail(error, context.requestId);
  }
};
