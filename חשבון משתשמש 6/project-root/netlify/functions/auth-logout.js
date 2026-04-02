const { requireUser } = require('./_shared/auth');
const { getAdminClient } = require('./_shared/supabase');
const { enforceRateLimit, markRateLimitOutcome, logHistory } = require('./_shared/history');
const { createHandler } = require('./_shared/handler');
const { logAuthAttempt, logAuthSuccess, logAuthFailure } = require('./_shared/authAudit');

exports.handler = createHandler({
  name: 'auth-logout',
  method: 'POST',
  auth: true,
  handler: async (event, _context, request) => {
    const user = await requireUser(event);
    const supabase = getAdminClient();
    const rateLimitKeys = [`ip:${request.ip}`, `user:${user.id}`, user.email ? `email:${String(user.email).toLowerCase()}` : null];

    logAuthAttempt({ action: 'auth-logout', userId: user.id, email: user.email || null, requestId: request.requestId, traceId: request.traceId, ip: request.ip });

    await enforceRateLimit(supabase, {
      endpoint: 'auth-logout',
      keys: rateLimitKeys,
      requestId: request.requestId,
      traceId: request.traceId,
      action: 'auth-logout',
      ip: request.ip
    });

    try {
      await logHistory(supabase, user.id, {
        actionType: 'auth.logout',
        entityType: 'session',
        entityId: 'current',
        status: 'success',
        metadata: {
          request_id: request.requestId,
          trace_id: request.traceId,
          ip: request.ip
        }
      });

      await markRateLimitOutcome(supabase, {
        endpoint: 'auth-logout',
        keys: rateLimitKeys,
        success: true,
        requestId: request.requestId,
        traceId: request.traceId,
        action: 'auth-logout',
        ip: request.ip
      });

      logAuthSuccess({ action: 'auth-logout', userId: user.id, email: user.email || null, requestId: request.requestId, traceId: request.traceId, ip: request.ip });

      return {
        statusCode: 200,
        data: {
          message: 'Logged out successfully.'
        }
      };
    } catch (error) {
      await markRateLimitOutcome(supabase, {
        endpoint: 'auth-logout',
        keys: rateLimitKeys,
        success: false,
        requestId: request.requestId,
        traceId: request.traceId,
        action: 'auth-logout',
        ip: request.ip
      });
      logAuthFailure({
        action: 'auth-logout',
        userId: user.id,
        email: user.email || null,
        requestId: request.requestId,
        traceId: request.traceId,
        ip: request.ip,
        reason: error.code || 'LOGOUT_FAILED'
      });
      throw error;
    }
  }
});
