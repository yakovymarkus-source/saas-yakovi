const { getAdminClient, getAnonClient } = require('./_shared/supabase');
const { requireEmail, validatePassword, validateName } = require('./_shared/validation');
const { enforceRateLimit, markRateLimitOutcome, logHistory } = require('./_shared/history');
const { parseJson, normalizeEmail } = require('./_shared/request');
const { loadEnv } = require('./_shared/env');
const { AppError } = require('./_shared/errors');
const { createHandler } = require('./_shared/handler');
const { logAuthAttempt, logAuthSuccess, logAuthFailure } = require('./_shared/authAudit');

exports.handler = createHandler({
  name: 'auth-signup',
  method: 'POST',
  handler: async (event, _context, request) => {
    const body = parseJson(event);
    const email = requireEmail(body.email);
    const normalizedEmail = normalizeEmail(email);
    const password = validatePassword(body.password);
    const fullName = validateName(body.full_name);
    const env = loadEnv();
    const admin = getAdminClient();
    const anon = getAnonClient();
    const rateLimitKeys = [`ip:${request.ip}`, `email:${normalizedEmail}`];

    logAuthAttempt({ action: 'auth-signup', email: normalizedEmail, requestId: request.requestId, traceId: request.traceId, ip: request.ip });

    await enforceRateLimit(admin, {
      endpoint: 'auth-signup',
      keys: rateLimitKeys,
      requestId: request.requestId,
      traceId: request.traceId,
      action: 'auth-signup',
      ip: request.ip
    });

    try {
      const { data, error } = await anon.auth.signUp({
        email: normalizedEmail,
        password,
        options: {
          emailRedirectTo: `${env.siteUrl}/#/settings`,
          data: { full_name: fullName }
        }
      });

      if (error) {
        throw new AppError('SIGNUP_FAILED', error.message, 400);
      }

      await markRateLimitOutcome(admin, {
        endpoint: 'auth-signup',
        keys: [...rateLimitKeys, data.user?.id ? `user:${data.user.id}` : null],
        success: true,
        requestId: request.requestId,
        traceId: request.traceId,
        action: 'auth-signup',
        ip: request.ip
      });

      if (data.user?.id) {
        await logHistory(admin, data.user.id, {
          actionType: 'auth.signup',
          entityType: 'account',
          entityId: data.user.id,
          status: 'success',
          metadata: {
            email: normalizedEmail,
            requires_email_verification: !data.session,
            request_id: request.requestId,
            trace_id: request.traceId,
            ip: request.ip
          }
        });
      }

      logAuthSuccess({
        action: 'auth-signup',
        email: normalizedEmail,
        userId: data.user?.id || null,
        requestId: request.requestId,
        traceId: request.traceId,
        ip: request.ip
      });

      return {
        statusCode: 200,
        data: {
          requires_email_verification: !data.session,
          session: data.session || null,
          user: data.user || null,
          message: data.session
            ? 'Account created successfully.'
            : 'Account created. Email verification is required before login.'
        }
      };
    } catch (error) {
      await markRateLimitOutcome(admin, {
        endpoint: 'auth-signup',
        keys: rateLimitKeys,
        success: false,
        requestId: request.requestId,
        traceId: request.traceId,
        action: 'auth-signup',
        ip: request.ip
      });
      logAuthFailure({
        action: 'auth-signup',
        email: normalizedEmail,
        requestId: request.requestId,
        traceId: request.traceId,
        ip: request.ip,
        reason: error.code || 'SIGNUP_FAILED'
      });
      throw error;
    }
  }
});
