const { requireUser } = require('./_shared/auth');
const { getAdminClient, getAnonClient } = require('./_shared/supabase');
const { validatePassword, validateCurrentPassword } = require('./_shared/validation');
const { logHistory, enforceRateLimit, markRateLimitOutcome } = require('./_shared/history');
const { parseJson } = require('./_shared/request');
const { AppError } = require('./_shared/errors');
const { createHandler } = require('./_shared/handler');
const { logAuthAttempt, logAuthSuccess, logAuthFailure } = require('./_shared/authAudit');

exports.handler = createHandler({
  name: 'auth-change-password',
  method: 'POST',
  auth: true,
  handler: async (event, _context, request) => {
    const user = await requireUser(event);
    const body = parseJson(event);
    const currentPassword = validateCurrentPassword(body.current_password);
    const newPassword = validatePassword(body.new_password);

    const supabase = getAdminClient();
    const anon = getAnonClient();
    const rateLimitKeys = [`ip:${request.ip}`, `user:${user.id}`, `email:${String(user.email || '').toLowerCase()}`];

    logAuthAttempt({ action: 'auth-change-password', userId: user.id, email: user.email || null, requestId: request.requestId, traceId: request.traceId, ip: request.ip });

    await enforceRateLimit(supabase, {
      endpoint: 'auth-change-password',
      keys: rateLimitKeys,
      requestId: request.requestId,
      traceId: request.traceId,
      action: 'auth-change-password',
      ip: request.ip
    });

    try {
      const { error: signInError } = await anon.auth.signInWithPassword({
        email: user.email,
        password: currentPassword
      });
      if (signInError) {
        throw new AppError('INVALID_CURRENT_PASSWORD', 'Current password is incorrect.', 401);
      }

      const { error: updateError } = await supabase.auth.admin.updateUserById(user.id, {
        password: newPassword
      });
      if (updateError) {
        throw new AppError('PASSWORD_CHANGE_FAILED', 'Failed to update password.', 500, updateError.message);
      }

      await markRateLimitOutcome(supabase, {
        endpoint: 'auth-change-password',
        keys: rateLimitKeys,
        success: true,
        requestId: request.requestId,
        traceId: request.traceId,
        action: 'auth-change-password',
        ip: request.ip
      });

      await logHistory(supabase, user.id, {
        actionType: 'auth.password_change',
        entityType: 'account',
        entityId: user.id,
        status: 'success',
        metadata: {
          request_id: request.requestId,
          trace_id: request.traceId,
          ip: request.ip
        }
      });

      logAuthSuccess({ action: 'auth-change-password', userId: user.id, email: user.email || null, requestId: request.requestId, traceId: request.traceId, ip: request.ip });

      return {
        statusCode: 200,
        data: {
          message: 'Password updated successfully.'
        }
      };
    } catch (error) {
      await markRateLimitOutcome(supabase, {
        endpoint: 'auth-change-password',
        keys: rateLimitKeys,
        success: false,
        requestId: request.requestId,
        traceId: request.traceId,
        action: 'auth-change-password',
        ip: request.ip
      });
      logAuthFailure({
        action: 'auth-change-password',
        userId: user.id,
        email: user.email || null,
        requestId: request.requestId,
        traceId: request.traceId,
        ip: request.ip,
        reason: error.code || 'PASSWORD_CHANGE_FAILED'
      });
      throw error;
    }
  }
});
