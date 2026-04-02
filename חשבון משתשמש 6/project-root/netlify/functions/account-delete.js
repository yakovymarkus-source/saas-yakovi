const crypto = require('crypto');
const { requireUser } = require('./_shared/auth');
const { getAdminClient, getAnonClient } = require('./_shared/supabase');
const { validateDeleteConfirmation, validateCurrentPassword } = require('./_shared/validation');
const { logHistory, enforceRateLimit, markRateLimitOutcome } = require('./_shared/history');
const { parseJson } = require('./_shared/request');
const { AppError } = require('./_shared/errors');
const { logger } = require('./_shared/logger');
const { createHandler } = require('./_shared/handler');

function anonymizedEmail() {
  const suffix = crypto.randomBytes(8).toString('hex');
  return `deleted+${suffix}@invalid.local`;
}

exports.handler = createHandler({
  name: 'account-delete',
  method: 'POST',
  auth: true,
  handler: async (event, _context, request) => {
    const user = await requireUser(event);
    const body = parseJson(event);
    validateDeleteConfirmation(body.confirmation);
    const currentPassword = validateCurrentPassword(body.current_password);

    const supabase = getAdminClient();
    const anon = getAnonClient();
    const rateLimitKeys = [`ip:${request.ip}`, `user:${user.id}`, `email:${String(user.email || '').toLowerCase()}`];

    logger.info('account-delete attempt', {
      action: 'account-delete',
      user_id: user.id,
      email: user.email || null,
      request_id: request.requestId,
      trace_id: request.traceId,
      ip: request.ip,
      outcome: 'attempt'
    });

    await enforceRateLimit(supabase, {
      endpoint: 'account-delete',
      keys: rateLimitKeys,
      requestId: request.requestId,
      traceId: request.traceId,
      action: 'account-delete',
      ip: request.ip
    });

    const { error: reauthError } = await anon.auth.signInWithPassword({
      email: user.email,
      password: currentPassword
    });
    if (reauthError) {
      await markRateLimitOutcome(supabase, {
        endpoint: 'account-delete',
        keys: rateLimitKeys,
        success: false,
        requestId: request.requestId,
        traceId: request.traceId,
        action: 'account-delete',
        ip: request.ip
      });
      throw new AppError('INVALID_CURRENT_PASSWORD', 'Current password is incorrect.', 401);
    }

    const { data: objects } = await supabase.storage.from('avatars').list(user.id, { limit: 100 });
    if (Array.isArray(objects) && objects.length) {
      await supabase.storage.from('avatars').remove(objects.map((item) => `${user.id}/${item.name}`));
    }

    const now = new Date().toISOString();
    const archivedEmail = anonymizedEmail();

    const { error: profileError } = await supabase
      .from('profiles')
      .update({
        email: archivedEmail,
        full_name: '[deleted]',
        avatar_url: null,
        deleted_at: now,
        onboarding_completed: false
      })
      .eq('user_id', user.id);

    if (profileError) {
      await markRateLimitOutcome(supabase, {
        endpoint: 'account-delete',
        keys: rateLimitKeys,
        success: false,
        requestId: request.requestId,
        traceId: request.traceId,
        action: 'account-delete',
        ip: request.ip
      });
      throw new AppError('ACCOUNT_DELETE_FAILED', 'Failed to deactivate profile.', 500, profileError.message);
    }

    const { error: auditError } = await supabase
      .from('account_deletions')
      .insert({
        user_id: user.id,
        original_email: user.email || '',
        archived_email: archivedEmail,
        deleted_at: now,
        reason: 'user_requested'
      });
    if (auditError) {
      await markRateLimitOutcome(supabase, {
        endpoint: 'account-delete',
        keys: rateLimitKeys,
        success: false,
        requestId: request.requestId,
        traceId: request.traceId,
        action: 'account-delete',
        ip: request.ip
      });
      throw new AppError('ACCOUNT_DELETE_FAILED', 'Failed to write delete audit.', 500, auditError.message);
    }

    await logHistory(supabase, user.id, {
      actionType: 'account.delete',
      entityType: 'account',
      entityId: user.id,
      status: 'requested',
      metadata: {
        deleted_at: now,
        request_id: request.requestId,
        trace_id: request.traceId,
        ip: request.ip
      }
    });

    const { error: adminUpdateError } = await supabase.auth.admin.updateUserById(user.id, {
      email: archivedEmail,
      user_metadata: {
        ...(user.user_metadata || {}),
        full_name: '[deleted]',
        account_deleted_at: now
      },
      app_metadata: {
        ...(user.app_metadata || {}),
        account_status: 'deleted'
      },
      ban_duration: '876000h'
    });

    if (adminUpdateError) {
      await markRateLimitOutcome(supabase, {
        endpoint: 'account-delete',
        keys: rateLimitKeys,
        success: false,
        requestId: request.requestId,
        traceId: request.traceId,
        action: 'account-delete',
        ip: request.ip
      });
      throw new AppError('ACCOUNT_DELETE_FAILED', 'Failed to disable auth user.', 500, adminUpdateError.message);
    }

    await markRateLimitOutcome(supabase, {
      endpoint: 'account-delete',
      keys: rateLimitKeys,
      success: true,
      requestId: request.requestId,
      traceId: request.traceId,
      action: 'account-delete',
      ip: request.ip
    });

    logger.info('account-delete success', {
      action: 'account-delete',
      user_id: user.id,
      email: user.email || null,
      request_id: request.requestId,
      trace_id: request.traceId,
      ip: request.ip,
      outcome: 'success'
    });

    return {
      statusCode: 200,
      data: {
        deleted_at: now
      }
    };
  }
});
