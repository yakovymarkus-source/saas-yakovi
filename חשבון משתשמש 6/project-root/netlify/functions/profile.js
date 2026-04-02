const { requireUser } = require('./_shared/auth');
const { getAdminClient } = require('./_shared/supabase');
const { validateName, validateAvatarUrl } = require('./_shared/validation');
const { logHistory, enforceRateLimit, markRateLimitOutcome } = require('./_shared/history');
const { parseJson } = require('./_shared/request');
const { AppError } = require('./_shared/errors');
const { createHandler } = require('./_shared/handler');
const { logger } = require('./_shared/logger');
const { getUserLinkageSummary } = require('./_shared/linkage');

async function ensureProfile(supabase, user) {
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id,email,full_name,avatar_url,onboarding_completed,created_at,updated_at,deleted_at')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) {
    throw new AppError('PROFILE_FETCH_FAILED', 'Failed to load profile.', 500, error.message);
  }

  if (data) return data;

  const { data: inserted, error: insertError } = await supabase
    .from('profiles')
    .insert({
      user_id: user.id,
      email: user.email || '',
      full_name: user.user_metadata?.full_name || '',
      avatar_url: null,
      onboarding_completed: false
    })
    .select('user_id,email,full_name,avatar_url,onboarding_completed,created_at,updated_at,deleted_at')
    .single();

  if (insertError) {
    throw new AppError('PROFILE_CREATE_FAILED', 'Failed to create profile.', 500, insertError.message);
  }

  return inserted;
}

exports.handler = createHandler({
  name: 'profile',
  allowMethods: ['GET', 'POST'],
  auth: true,
  handler: async (event, _context, request) => {
    const user = await requireUser(event);
    const supabase = getAdminClient();
    const rateLimitKeys = [`ip:${request.ip}`, `user:${user.id}`];

    await enforceRateLimit(supabase, {
      endpoint: 'profile',
      keys: rateLimitKeys,
      requestId: request.requestId,
      traceId: request.traceId,
      action: 'profile',
      ip: request.ip
    });

    if (event.httpMethod === 'GET') {
      logger.info('profile attempt', {
        action: 'profile',
        user_id: user.id,
        request_id: request.requestId,
        trace_id: request.traceId,
        ip: request.ip,
        outcome: 'attempt'
      });

      const profile = await ensureProfile(supabase, user);
      const linkage = await getUserLinkageSummary(supabase, user.id);

      await markRateLimitOutcome(supabase, {
        endpoint: 'profile',
        keys: rateLimitKeys,
        success: true,
        requestId: request.requestId,
        traceId: request.traceId,
        action: 'profile',
        ip: request.ip
      });

      logger.info('profile success', {
        action: 'profile',
        user_id: user.id,
        request_id: request.requestId,
        trace_id: request.traceId,
        ip: request.ip,
        outcome: 'success'
      });

      return {
        statusCode: 200,
        data: {
          profile,
          activity_summary: linkage
        }
      };
    }

    logger.info('profile attempt', {
      action: 'profile',
      user_id: user.id,
      request_id: request.requestId,
      trace_id: request.traceId,
      ip: request.ip,
      outcome: 'attempt'
    });

    const body = parseJson(event);
    const fullName = validateName(body.full_name);
    const avatarUrl = validateAvatarUrl(body.avatar_url, user.id);
    const existing = await ensureProfile(supabase, user);
    const avatarChanged = existing.avatar_url !== avatarUrl;

    const { data, error } = await supabase
      .from('profiles')
      .update({
        full_name: fullName,
        avatar_url: avatarUrl,
        email: user.email || ''
      })
      .eq('user_id', user.id)
      .select('user_id,email,full_name,avatar_url,onboarding_completed,created_at,updated_at,deleted_at')
      .single();

    if (error) {
      await markRateLimitOutcome(supabase, {
        endpoint: 'profile',
        keys: rateLimitKeys,
        success: false,
        requestId: request.requestId,
        traceId: request.traceId,
        action: 'profile',
        ip: request.ip
      });
      logger.warn('profile failure', {
        action: 'profile',
        user_id: user.id,
        request_id: request.requestId,
        trace_id: request.traceId,
        ip: request.ip,
        outcome: 'failure',
        reason: 'PROFILE_UPDATE_FAILED'
      });
      throw new AppError('PROFILE_UPDATE_FAILED', 'Failed to update profile.', 500, error.message);
    }

    const { error: authUpdateError } = await supabase.auth.admin.updateUserById(user.id, {
      user_metadata: {
        ...(user.user_metadata || {}),
        full_name: fullName
      }
    });

    if (authUpdateError) {
      await markRateLimitOutcome(supabase, {
        endpoint: 'profile',
        keys: rateLimitKeys,
        success: false,
        requestId: request.requestId,
        traceId: request.traceId,
        action: 'profile',
        ip: request.ip
      });
      throw new AppError('PROFILE_AUTH_SYNC_FAILED', 'Failed to sync auth metadata.', 500, authUpdateError.message);
    }

    await logHistory(supabase, user.id, {
      actionType: 'profile.update',
      entityType: 'profile',
      entityId: user.id,
      status: 'success',
      metadata: {
        full_name: fullName,
        avatar_changed: avatarChanged,
        request_id: request.requestId,
        trace_id: request.traceId,
        ip: request.ip
      }
    });

    const linkage = await getUserLinkageSummary(supabase, user.id);

    await markRateLimitOutcome(supabase, {
      endpoint: 'profile',
      keys: rateLimitKeys,
      success: true,
      requestId: request.requestId,
      traceId: request.traceId,
      action: 'profile',
      ip: request.ip
    });

    logger.info('profile success', {
      action: 'profile',
      user_id: user.id,
      request_id: request.requestId,
      trace_id: request.traceId,
      ip: request.ip,
      outcome: 'success'
    });

    return {
      statusCode: 200,
      data: {
        profile: data,
        activity_summary: linkage
      }
    };
  }
});
