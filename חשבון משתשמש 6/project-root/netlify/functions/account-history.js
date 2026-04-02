const { requireUser } = require('./_shared/auth');
const { getAdminClient } = require('./_shared/supabase');
const { loadEnv } = require('./_shared/env');
const { enforceRateLimit, markRateLimitOutcome } = require('./_shared/history');
const { AppError } = require('./_shared/errors');
const { createHandler } = require('./_shared/handler');
const { logger } = require('./_shared/logger');
const { getUserLinkageSummary } = require('./_shared/linkage');

exports.handler = createHandler({
  name: 'account-history',
  method: 'GET',
  auth: true,
  handler: async (event, _context, request) => {
    const user = await requireUser(event);
    const supabase = getAdminClient();
    const env = loadEnv();
    const rateLimitKeys = [`ip:${request.ip}`, `user:${user.id}`];

    logger.info('account-history attempt', {
      action: 'account-history',
      user_id: user.id,
      request_id: request.requestId,
      trace_id: request.traceId,
      ip: request.ip,
      outcome: 'attempt'
    });

    await enforceRateLimit(supabase, {
      endpoint: 'account-history',
      keys: rateLimitKeys,
      requestId: request.requestId,
      traceId: request.traceId,
      action: 'account-history',
      ip: request.ip
    });

    const cursor = event.queryStringParameters?.cursor || null;
    const pageSize = env.historyPageSize;

    let query = supabase
      .from('user_history')
      .select('id,user_id,action_type,entity_type,entity_id,campaign_id,analysis_id,status,metadata,created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(pageSize + 1);

    if (cursor) {
      query = query.lt('created_at', cursor);
    }

    const { data, error } = await query;
    if (error) {
      await markRateLimitOutcome(supabase, {
        endpoint: 'account-history',
        keys: rateLimitKeys,
        success: false,
        requestId: request.requestId,
        traceId: request.traceId,
        action: 'account-history',
        ip: request.ip
      });
      logger.warn('account-history failure', {
        action: 'account-history',
        user_id: user.id,
        request_id: request.requestId,
        trace_id: request.traceId,
        ip: request.ip,
        outcome: 'failure',
        reason: 'HISTORY_FETCH_FAILED'
      });
      throw new AppError('HISTORY_FETCH_FAILED', 'Failed to fetch account history.', 500, error.message);
    }

    const items = Array.isArray(data) ? data.slice(0, pageSize) : [];
    const nextCursor = data && data.length > pageSize ? items[items.length - 1].created_at : null;
    const linkage = await getUserLinkageSummary(supabase, user.id);

    await markRateLimitOutcome(supabase, {
      endpoint: 'account-history',
      keys: rateLimitKeys,
      success: true,
      requestId: request.requestId,
      traceId: request.traceId,
      action: 'account-history',
      ip: request.ip
    });

    logger.info('account-history success', {
      action: 'account-history',
      user_id: user.id,
      request_id: request.requestId,
      trace_id: request.traceId,
      ip: request.ip,
      outcome: 'success'
    });

    return {
      statusCode: 200,
      data: {
        items,
        next_cursor: nextCursor,
        activity_summary: linkage
      }
    };
  }
});
