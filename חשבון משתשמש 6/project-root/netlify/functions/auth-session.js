const { requireUser } = require('./_shared/auth');
const { getAdminClient } = require('./_shared/supabase');
const { enforceRateLimit, markRateLimitOutcome, logHistory } = require('./_shared/history');
const { createHandler } = require('./_shared/handler');
const { logAuthAttempt, logAuthSuccess, logAuthFailure } = require('./_shared/authAudit');

exports.handler = createHandler({
  name: 'auth-session',
  method: 'GET',
  auth: true,
  handler: async (event, _context, request) => {
    const user = await requireUser(event);
    const supabase = getAdminClient();
    const rateLimitKeys = [`ip:${request.ip}`, `user:${user.id}`, user.email ? `email:${String(user.email).toLowerCase()}` : null];

    logAuthAttempt({ action: 'auth-session', userId: user.id, email: user.email || null, requestId: request.requestId, traceId: request.traceId, ip: request.ip });

    await enforceRateLimit(supabase, {
      endpoint: 'auth-session',
      keys: rateLimitKeys,
      requestId: request.requestId,
      traceId: request.traceId,
      action: 'auth-session',
      ip: request.ip
    });

    try {
      await markRateLimitOutcome(supabase, {
        endpoint: 'auth-session',
        keys: rateLimitKeys,
        success: true,
        requestId: request.requestId,
        traceId: request.traceId,
        action: 'auth-session',
        ip: request.ip
      });

      await logHistory(supabase, user.id, {
        actionType: 'auth.session',
        entityType: 'account',
        entityId: user.id,
        status: 'success',
        metadata: {
          request_id: request.requestId,
          trace_id: request.traceId,
          ip: request.ip,
          email: user.email || null
        }
      });

      logAuthSuccess({ action: 'auth-session', userId: user.id, email: user.email || null, requestId: request.requestId, traceId: request.traceId, ip: request.ip });

      return {
        statusCode: 200,
        data: {
          user
        }
      };
    } catch (error) {
      await markRateLimitOutcome(supabase, {
        endpoint: 'auth-session',
        keys: rateLimitKeys,
        success: false,
        requestId: request.requestId,
        traceId: request.traceId,
        action: 'auth-session',
        ip: request.ip
      });
      logAuthFailure({
        action: 'auth-session',
        userId: user.id,
        email: user.email || null,
        requestId: request.requestId,
        traceId: request.traceId,
        ip: request.ip,
        reason: error.code || 'SESSION_FETCH_FAILED'
      });
      throw error;
    }
  }
});
