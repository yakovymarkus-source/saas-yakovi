const { requireUser } = require('./_shared/auth');
const { getAdminClient } = require('./_shared/supabase');
const { logHistory, enforceRateLimit, markRateLimitOutcome } = require('./_shared/history');
const { parseJson } = require('./_shared/request');
const { AppError } = require('./_shared/errors');
const { logger } = require('./_shared/logger');
const { createHandler } = require('./_shared/handler');

exports.handler = createHandler({
  name: 'onboarding-complete',
  method: 'POST',
  auth: true,
  handler: async (event, _context, request) => {
    const user = await requireUser(event);
    const supabase = getAdminClient();
    const rateLimitKeys = [`ip:${request.ip}`, `user:${user.id}`];

    logger.info('onboarding-complete attempt', {
      action: 'onboarding-complete',
      user_id: user.id,
      request_id: request.requestId,
      trace_id: request.traceId,
      ip: request.ip,
      outcome: 'attempt'
    });

    await enforceRateLimit(supabase, {
      endpoint: 'onboarding-complete',
      keys: rateLimitKeys,
      requestId: request.requestId,
      traceId: request.traceId,
      action: 'onboarding-complete',
      ip: request.ip
    });

    const body = parseJson(event);
    if (body.onboarding_completed !== true) {
      await markRateLimitOutcome(supabase, {
        endpoint: 'onboarding-complete',
        keys: rateLimitKeys,
        success: false,
        requestId: request.requestId,
        traceId: request.traceId,
        action: 'onboarding-complete',
        ip: request.ip
      });
      throw new AppError('INVALID_BODY', 'Invalid onboarding payload.', 400);
    }

    const { data, error } = await supabase
      .from('profiles')
      .update({ onboarding_completed: true })
      .eq('user_id', user.id)
      .select('user_id,email,full_name,avatar_url,onboarding_completed,created_at,updated_at,deleted_at')
      .single();

    if (error) {
      await markRateLimitOutcome(supabase, {
        endpoint: 'onboarding-complete',
        keys: rateLimitKeys,
        success: false,
        requestId: request.requestId,
        traceId: request.traceId,
        action: 'onboarding-complete',
        ip: request.ip
      });
      logger.warn('onboarding-complete failure', {
        action: 'onboarding-complete',
        user_id: user.id,
        request_id: request.requestId,
        trace_id: request.traceId,
        ip: request.ip,
        outcome: 'failure',
        reason: 'ONBOARDING_UPDATE_FAILED'
      });
      throw new AppError('ONBOARDING_UPDATE_FAILED', 'Failed to complete onboarding.', 500, error.message);
    }

    await logHistory(supabase, user.id, {
      actionType: 'account.onboarding',
      entityType: 'profile',
      entityId: user.id,
      status: 'completed',
      metadata: {
        completed: true,
        request_id: request.requestId,
        trace_id: request.traceId,
        ip: request.ip
      }
    });

    await markRateLimitOutcome(supabase, {
      endpoint: 'onboarding-complete',
      keys: rateLimitKeys,
      success: true,
      requestId: request.requestId,
      traceId: request.traceId,
      action: 'onboarding-complete',
      ip: request.ip
    });

    logger.info('onboarding-complete success', {
      action: 'onboarding-complete',
      user_id: user.id,
      request_id: request.requestId,
      trace_id: request.traceId,
      ip: request.ip,
      outcome: 'success'
    });

    return {
      statusCode: 200,
      data: {
        profile: data
      }
    };
  }
});
