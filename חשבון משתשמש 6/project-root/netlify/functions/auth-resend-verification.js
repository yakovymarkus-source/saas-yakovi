const { getAdminClient, getAnonClient } = require('./_shared/supabase');
const { requireEmail } = require('./_shared/validation');
const { enforceRateLimit, markRateLimitOutcome, logHistoryByEmail } = require('./_shared/history');
const { parseJson, normalizeEmail } = require('./_shared/request');
const { loadEnv } = require('./_shared/env');
const { AppError } = require('./_shared/errors');
const { createHandler } = require('./_shared/handler');
const { logAuthAttempt, logAuthSuccess, logAuthFailure } = require('./_shared/authAudit');

exports.handler = createHandler({
  name: 'auth-resend-verification',
  method: 'POST',
  handler: async (event, _context, request) => {
    const body = parseJson(event);
    const email = requireEmail(body.email);
    const normalizedEmail = normalizeEmail(email);
    const env = loadEnv();
    const admin = getAdminClient();
    const anon = getAnonClient();
    const rateLimitKeys = [`ip:${request.ip}`, `email:${normalizedEmail}`];

    logAuthAttempt({ action: 'auth-resend-verification', email: normalizedEmail, requestId: request.requestId, traceId: request.traceId, ip: request.ip });

    await enforceRateLimit(admin, {
      endpoint: 'auth-resend-verification',
      keys: rateLimitKeys,
      requestId: request.requestId,
      traceId: request.traceId,
      action: 'auth-resend-verification',
      ip: request.ip
    });

    try {
      const { error } = await anon.auth.resend({
        type: 'signup',
        email: normalizedEmail,
        options: {
          emailRedirectTo: `${env.siteUrl}/#/settings`
        }
      });

      if (error) {
        throw new AppError('RESEND_FAILED', error.message, 400);
      }

      await markRateLimitOutcome(admin, {
        endpoint: 'auth-resend-verification',
        keys: rateLimitKeys,
        success: true,
        requestId: request.requestId,
        traceId: request.traceId,
        action: 'auth-resend-verification',
        ip: request.ip
      });

      await logHistoryByEmail(admin, normalizedEmail, {
        actionType: 'auth.verification_resend',
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

      logAuthSuccess({ action: 'auth-resend-verification', email: normalizedEmail, requestId: request.requestId, traceId: request.traceId, ip: request.ip });

      return {
        statusCode: 200,
        data: {
          message: 'Verification email resent if the account exists and is pending verification.'
        }
      };
    } catch (error) {
      await markRateLimitOutcome(admin, {
        endpoint: 'auth-resend-verification',
        keys: rateLimitKeys,
        success: false,
        requestId: request.requestId,
        traceId: request.traceId,
        action: 'auth-resend-verification',
        ip: request.ip
      });
      logAuthFailure({
        action: 'auth-resend-verification',
        email: normalizedEmail,
        requestId: request.requestId,
        traceId: request.traceId,
        ip: request.ip,
        reason: error.code || 'RESEND_FAILED'
      });
      throw error;
    }
  }
});
