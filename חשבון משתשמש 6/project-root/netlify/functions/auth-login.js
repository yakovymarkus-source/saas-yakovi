const { getAdminClient, getAnonClient } = require('./_shared/supabase');
const { requireEmail } = require('./_shared/validation');
const { enforceRateLimit, logHistory, markRateLimitOutcome } = require('./_shared/history');
const { parseJson, normalizeEmail } = require('./_shared/request');
const { AppError } = require('./_shared/errors');
const { createHandler } = require('./_shared/handler');
const { logAuthAttempt, logAuthSuccess, logAuthFailure } = require('./_shared/authAudit');

exports.handler = createHandler({
  name: 'auth-login',
  method: 'POST',
  handler: async (event, _context, request) => {
    const body = parseJson(event);
    const email = requireEmail(body.email);
    const normalizedEmail = normalizeEmail(email);
    const password = String(body.password || '');
    if (!password) {
      throw new AppError('INVALID_PASSWORD', 'Password is required.', 400);
    }

    const admin = getAdminClient();
    const anon = getAnonClient();
    const rateLimitKeys = [`ip:${request.ip}`, `email:${normalizedEmail}`];

    logAuthAttempt({ action: 'auth-login', email: normalizedEmail, requestId: request.requestId, traceId: request.traceId, ip: request.ip });

    await enforceRateLimit(admin, {
      endpoint: 'auth-login',
      keys: rateLimitKeys,
      requestId: request.requestId,
      traceId: request.traceId,
      action: 'auth-login',
      ip: request.ip
    });

    try {
      const { data, error } = await anon.auth.signInWithPassword({ email: normalizedEmail, password });
      if (error) {
        throw new AppError('LOGIN_FAILED', error.message, 401);
      }

      if (data.user?.banned_until || data.user?.app_metadata?.account_status === 'deleted') {
        throw new AppError('ACCOUNT_DISABLED', 'This account is disabled.', 403);
      }

      await markRateLimitOutcome(admin, {
        endpoint: 'auth-login',
        keys: [...rateLimitKeys, data.user?.id ? `user:${data.user.id}` : null],
        success: true,
        requestId: request.requestId,
        traceId: request.traceId,
        action: 'auth-login',
        ip: request.ip
      });

      await logHistory(admin, data.user.id, {
        actionType: 'auth.login',
        entityType: 'session',
        entityId: data.session?.user?.id || 'current',
        status: 'success',
        metadata: {
          email: normalizedEmail,
          request_id: request.requestId,
          trace_id: request.traceId,
          ip: request.ip
        }
      });

      logAuthSuccess({
        action: 'auth-login',
        email: normalizedEmail,
        userId: data.user.id,
        requestId: request.requestId,
        traceId: request.traceId,
        ip: request.ip
      });

      return {
        statusCode: 200,
        data: {
          session: data.session,
          user: data.user,
          message: 'Logged in successfully.'
        }
      };
    } catch (error) {
      await markRateLimitOutcome(admin, {
        endpoint: 'auth-login',
        keys: rateLimitKeys,
        success: false,
        requestId: request.requestId,
        traceId: request.traceId,
        action: 'auth-login',
        ip: request.ip
      });
      logAuthFailure({
        action: 'auth-login',
        email: normalizedEmail,
        requestId: request.requestId,
        traceId: request.traceId,
        ip: request.ip,
        reason: error.code || 'LOGIN_FAILED'
      });
      throw error;
    }
  }
});
