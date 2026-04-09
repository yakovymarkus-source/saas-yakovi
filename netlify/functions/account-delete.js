const { ok, fail } = require('./_shared/http');
const { createRequestContext, buildLogPayload } = require('./_shared/observability');
const { writeRequestLog } = require('./_shared/supabase');
const { requireAuth } = require('./_shared/auth');
const { softDeleteAccount } = require('./_shared/account');
const { AppError } = require('./_shared/errors');
const { parseJsonBody } = require('./_shared/request');

exports.handler = async (event) => {
  const context = createRequestContext(event, 'account-delete');
  try {
    if (event.httpMethod !== 'POST') {
      throw new AppError({ code: 'METHOD_NOT_ALLOWED', userMessage: 'Method not allowed', devMessage: 'Unsupported method', status: 405 });
    }
    const user = await requireAuth(event, context.functionName, context);
    const body = parseJsonBody(event, { fallback: {}, allowEmpty: false, devMessage: 'Invalid JSON in account-delete body' });
    if (body.confirmation !== 'DELETE') {
      throw new AppError({ code: 'DELETE_CONFIRMATION_REQUIRED', userMessage: 'כדי למחוק חשבון צריך להקליד DELETE.', devMessage: 'Missing deletion confirmation', status: 400 });
    }
    const data = await softDeleteAccount(user.id);
    await writeRequestLog(buildLogPayload(context, 'info', 'account_deleted', { user_id: user.id }));
    return ok(data, context.requestId, { 'X-Correlation-Id': context.correlationId });
  } catch (error) {
    await writeRequestLog(buildLogPayload(context, 'error', error.message || 'account_delete_failed', { code: error.code || 'INTERNAL_ERROR' })).catch(() => {});
    return fail(error, context.requestId);
  }
};
