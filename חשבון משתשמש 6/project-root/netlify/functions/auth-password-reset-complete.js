const { requireUser } = require('./_shared/auth');
const { getAdminClient } = require('./_shared/supabase');
const { validatePassword } = require('./_shared/validation');
const { logHistory, enforceRateLimit, markRateLimitOutcome } = require('./_shared/history');
const { parseJson } = require('./_shared/request');
const { AppError } = require('./_shared/errors');
const { createHandler } = require('./_shared/handler');
const { logAuthAttempt, logAuthSuccess, logAuthFailure } = require('./_shared/authAudit');

exports.handler = createHandler({
  name: 'auth-password-reset-complete',
  method: 'POST',
  auth: true,
  handler: async (event, _context, request) => {
    const user = await requireUser(event);
    const body = parseJson(event);
    const newPassword = validatePassword(body.new_password);
    const supabase = getAdminClient();
    const rateLimitKeys = [`ip:${request.ip}`, `user:${user.id}`, user.email ? `email:${String(user.email).toLowerCase()}` : null];

    logAuthAttempt({ action: 'auth-password-reset-complete', userId: user.id, email: user.email || null, requestId: request.requestId, traceId: request.traceId, ip: request.ip });

    await enforceRateLimit(supabase, {
      endpoint: 'auth-password-reset-complete',
      keys: rateLimitKeys,
      requestId: request.requestId,
      traceId: request.traceId,
      action: 'auth-password-reset-complete',
      ip: request.ip
    });

    try {
      const { error } = await supabase.auth.admin.updateUserById(user.id, { password: newPassword });
      if (error) {
        throw new AppError('RESET_COMPLETE_FAILED', 'Failed to update password.', 500, error.message);
      }

      await markRateLimitOutcome(supabase, {
        endpoint: 'auth-password-reset-complete',
        keys: rateLimitKeys,
        success: true,
        requestId: request.requestId,
        traceId: request.traceId,
        action: 'auth-password-reset-complete',
        ip: request.ip
      });

      await logHistory(supabase, user.id, {
        actionType: 'auth.password_reset_complete',
        entityType: 'account',
        entityId: user.id,
        status: 'completed',
        metadata: {
          request_id: request.requestId,
          trace_id: request.traceId,
          ip: request.ip
        }
      });

      logAuthSuccess({ action: 'auth-password-reset-complete', userId: user.id, email: user.email || null, requestId: request.requestId, traceId: request.traceId, ip: request.ip });

      return {
        statusCode: 200,
        data: {
          message: 'Password updated successfully.'
        }
      };
    } catch (error) {
      await markRateLimitOutcome(supabase, {
        endpoint: 'auth-password-reset-complete',
        keys: rateLimitKeys,
        success: false,
        requestId: request.requestId,
        traceId: request.traceId,
        action: 'auth-password-reset-complete',
        ip: request.ip
      });
      logAuthFailure({
        action: 'auth-password-reset-complete',
        userId: user.id,
        email: user.email || null,
        requestId: request.requestId,
        traceId: request.traceId,
        ip: request.ip,
        reason: error.code || 'RESET_COMPLETE_FAILED'
      });
      throw error;
    }
  }
});
