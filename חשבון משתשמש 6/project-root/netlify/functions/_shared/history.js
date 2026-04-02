const { AppError } = require('./errors');
const { assertRateLimit, registerRateLimitOutcome } = require('./rateLimitRepository');
const { syncUserLinkageSummary } = require('./linkage');
const { logger } = require('./logger');

function deriveLegacyAction(actionType, status) {
  return status ? `${actionType}.${status}` : actionType;
}

function normalizeHistoryPayload(payload) {
  const normalized = typeof payload === 'string'
    ? { actionType: payload }
    : { ...(payload || {}) };

  const metadata = normalized.metadata || {};

  return {
    actionType: normalized.actionType || 'account.activity',
    entityType: normalized.entityType || 'account',
    entityId: normalized.entityId || null,
    status: normalized.status || 'success',
    category: normalized.category || String(normalized.actionType || 'general').split('.')[0],
    metadata,
    campaignId: normalized.campaignId || metadata.campaign_id || null,
    analysisId: normalized.analysisId || metadata.analysis_id || null,
    createdAt: normalized.createdAt || null,
    traceId: normalized.traceId || metadata.trace_id || metadata.request_id || null,
    requestId: normalized.requestId || metadata.request_id || null
  };
}

async function logHistory(supabase, userId, payload) {
  const normalized = normalizeHistoryPayload(payload);
  const row = {
    user_id: userId,
    action: deriveLegacyAction(normalized.actionType, normalized.status),
    action_type: normalized.actionType,
    entity_type: normalized.entityType,
    entity_id: normalized.entityId,
    status: normalized.status,
    category: normalized.category,
    metadata: {
      ...normalized.metadata,
      request_id: normalized.requestId || normalized.traceId || null,
      trace_id: normalized.traceId || normalized.requestId || null
    },
    campaign_id: normalized.campaignId,
    analysis_id: normalized.analysisId
  };

  if (normalized.createdAt) {
    row.created_at = normalized.createdAt;
  }

  logger.info('history.write attempt', {
    action: 'history.write',
    user_id: userId,
    request_id: normalized.requestId,
    trace_id: normalized.traceId || normalized.requestId,
    outcome: 'attempt',
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    action_type: row.action_type,
    campaign_id: row.campaign_id,
    analysis_id: row.analysis_id
  });

  const { error } = await supabase.from('user_history').insert(row);
  if (error) {
    logger.warn('history.write failure', {
      action: 'history.write',
      user_id: userId,
      request_id: normalized.requestId,
      trace_id: normalized.traceId || normalized.requestId,
      outcome: 'failure',
      reason: 'HISTORY_WRITE_FAILED',
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      action_type: row.action_type
    });
    throw new AppError('HISTORY_WRITE_FAILED', 'Failed to write user history.', 500, error.message);
  }

  const linkage = await syncUserLinkageSummary(supabase, userId, {
    traceId: normalized.traceId,
    requestId: normalized.requestId,
    source: row.action_type
  });

  logger.info('history.write success', {
    action: 'history.write',
    user_id: userId,
    request_id: normalized.requestId,
    trace_id: normalized.traceId || normalized.requestId,
    outcome: 'success',
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    action_type: row.action_type,
    campaign_id: row.campaign_id,
    analysis_id: row.analysis_id,
    last_activity_at: linkage?.last_activity_at || null
  });

  return row;
}

async function findUserIdByEmail(supabase, email) {
  if (!email) return null;
  const normalizedEmail = String(email).trim().toLowerCase();
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id')
    .ilike('email', normalizedEmail)
    .maybeSingle();

  if (error) {
    throw new AppError('PROFILE_LOOKUP_FAILED', 'Failed to resolve account activity owner.', 500, error.message);
  }

  return data?.user_id || null;
}

async function logHistoryByEmail(supabase, email, payload) {
  const userId = await findUserIdByEmail(supabase, email);
  if (!userId) return null;
  return logHistory(supabase, userId, payload);
}

async function enforceRateLimit(supabase, options) {
  return assertRateLimit(supabase, options);
}

async function markRateLimitOutcome(supabase, options) {
  return registerRateLimitOutcome(supabase, options);
}

module.exports = {
  logHistory,
  logHistoryByEmail,
  findUserIdByEmail,
  enforceRateLimit,
  markRateLimitOutcome,
  normalizeHistoryPayload
};
