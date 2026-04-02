const { getAdminClient, getAnonClient } = require('./_shared/supabase');
const { requireEmail } = require('./_shared/validation');
const { enforceRateLimit, markRateLimitOutcome, logHistoryByEmail } = require('./_shared/history');
const { parseJson, normalizeEmail } = require('./_shared/request');
const { loadEnv } = require('./_shared/env');
const { AppError } = require('./_shared/errors');
const { createHandler } = require('./_shared/handler');
const { logAuthAttempt, logAuthSuccess, logAuthFailure } = require('./_shared/authAudit');

exports.handler = createHandler({
  name: 'auth-password-reset-request',
  method: 'POST',
  handler: async (event, _context, request) => {
    const body = parseJson(event);
    const email = requireEmail(body.email);
    const normalizedEmail = normalizeEmail(email);
    const env = loadEnv();
    const admin = getAdminClient();
    const anon = getAnonClient();
    const rateLimitKeys = [`ip:${request.ip}`, `email:${normalizedEmail}`];

    logAuthAttempt({ action: 'auth-password-reset-request', email: normalizedEmail, requestId: request.requestId, traceId: request.traceId, ip: request.ip });

    await enforceRateLimit(admin, {
      endpoint: 'auth-password-reset-request',
      keys: rateLimitKeys,
      requestId: request.requestId,
      traceId: request.traceId,
      action: 'auth-password-reset-request',
      ip: request.ip
    });

    try {
      const { error } = await anon.auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo: `${env.siteUrl}/#type=recovery`
      });

      if (error) {
        throw new AppError('RESET_REQUEST_FAILED', error.message, 400);
      }

      await markRateLimitOutcome(admin, {
        endpoint: 'auth-password-reset-request',
        keys: rateLimitKeys,
        success: true,
        requestId: request.requestId,
        traceId: request.traceId,
        action: 'auth-password-reset-request',
        ip: request.ip
      });

      await logHistoryByEmail(admin, normalizedEmail, {
        actionType: 'auth.password_reset_request',
        entityType: 'account',
        entityId: normalizedEmail,
        status: 'requested',
        metadata: {
          email: normalizedEmail,
          request_id: request.requestId,
          trace_id: request.traceId,
          ip: request.ip
        }
      });

      logAuthSuccess({
        action: 'auth-password-reset-request',
        email: normalizedEmail,
        requestId: request.requestId,
        traceId: request.traceId,
        ip: request.ip
      });

      return {
        statusCode: 200,
        data: {
          message: 'If the email exists, a reset link has been sent.'
        }
      };
    } catch (error) {
      await markRateLimitOutcome(admin, {
        endpoint: 'auth-password-reset-request',
        keys: rateLimitKeys,
        success: false,
        requestId: request.requestId,
        traceId: request.traceId,
        action: 'auth-password-reset-request',
        ip: request.ip
      });
      logAuthFailure({
        action: 'auth-password-reset-request',
        email: normalizedEmail,
        requestId: request.requestId,
        traceId: request.traceId,
        ip: request.ip,
        reason: error.code || 'RESET_REQUEST_FAILED'
      });
      throw error;
    }
  }
});
