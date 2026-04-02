const { RateLimitError, AppError } = require('./errors');
const { logger } = require('./logger');
const { hashValue } = require('./request');

const ENDPOINT_POLICIES = {
  'auth-login': { windowSeconds: 900, baseLimit: 6, burstLimit: 12, blockSeconds: 1800, abuseFailures: 3, abuseHits: 9 },
  'auth-signup': { windowSeconds: 3600, baseLimit: 4, burstLimit: 8, blockSeconds: 3600, abuseFailures: 2, abuseHits: 6 },
  'auth-password-reset-request': { windowSeconds: 3600, baseLimit: 3, burstLimit: 6, blockSeconds: 7200, abuseFailures: 2, abuseHits: 5 },
  'auth-password-reset-complete': { windowSeconds: 1800, baseLimit: 5, burstLimit: 8, blockSeconds: 3600, abuseFailures: 2, abuseHits: 6 },
  'auth-change-password': { windowSeconds: 1800, baseLimit: 5, burstLimit: 8, blockSeconds: 3600, abuseFailures: 2, abuseHits: 6 },
  'auth-resend-verification': { windowSeconds: 3600, baseLimit: 3, burstLimit: 6, blockSeconds: 3600, abuseFailures: 2, abuseHits: 5 },
  'auth-session': { windowSeconds: 300, baseLimit: 30, burstLimit: 45, blockSeconds: 600, abuseFailures: 4, abuseHits: 25 },
  'auth-logout': { windowSeconds: 300, baseLimit: 20, burstLimit: 30, blockSeconds: 600, abuseFailures: 4, abuseHits: 18 },
  'profile': { windowSeconds: 300, baseLimit: 30, burstLimit: 45, blockSeconds: 600, abuseFailures: 4, abuseHits: 25 },
  'account-history': { windowSeconds: 300, baseLimit: 30, burstLimit: 45, blockSeconds: 600, abuseFailures: 4, abuseHits: 25 },
  'account-delete': { windowSeconds: 1800, baseLimit: 3, burstLimit: 5, blockSeconds: 3600, abuseFailures: 2, abuseHits: 4 },
  'onboarding-complete': { windowSeconds: 600, baseLimit: 10, burstLimit: 20, blockSeconds: 900, abuseFailures: 3, abuseHits: 12 },
  default: { windowSeconds: 300, baseLimit: 20, burstLimit: 30, blockSeconds: 900, abuseFailures: 4, abuseHits: 20 }
};

function getPolicy(endpoint) {
  return ENDPOINT_POLICIES[endpoint] || ENDPOINT_POLICIES.default;
}

function bucketStartIso(windowSeconds, now = new Date()) {
  const ms = windowSeconds * 1000;
  return new Date(Math.floor(now.getTime() / ms) * ms).toISOString();
}

async function upsertCounter(supabase, { actorKey, endpoint, windowStart, incrementBy = 1 }) {
  const { data: existing, error: readError } = await supabase
    .from('request_rate_limits')
    .select('actor_key,endpoint,window_start,hits,updated_at')
    .eq('actor_key', actorKey)
    .eq('endpoint', endpoint)
    .eq('window_start', windowStart)
    .maybeSingle();

  if (readError) {
    throw new AppError('RATE_LIMIT_READ_FAILED', 'Failed to read rate limit state.', 500, readError.message);
  }

  const nextHits = (existing?.hits || 0) + incrementBy;
  const { error: writeError } = await supabase
    .from('request_rate_limits')
    .upsert({ actor_key: actorKey, endpoint, window_start: windowStart, hits: nextHits });

  if (writeError) {
    throw new AppError('RATE_LIMIT_WRITE_FAILED', 'Failed to update rate limit state.', 500, writeError.message);
  }

  return nextHits;
}

async function getState(supabase, actorHash, endpoint) {
  const { data, error } = await supabase
    .from('request_rate_limit_state')
    .select('actor_hash,endpoint,failure_count,success_count,blocked_until,last_seen_at')
    .eq('actor_hash', actorHash)
    .eq('endpoint', endpoint)
    .maybeSingle();

  if (error) {
    throw new AppError('RATE_LIMIT_STATE_READ_FAILED', 'Failed to read abuse state.', 500, error.message);
  }

  return data;
}

async function saveState(supabase, row) {
  const { error } = await supabase.from('request_rate_limit_state').upsert(row);
  if (error) {
    throw new AppError('RATE_LIMIT_STATE_WRITE_FAILED', 'Failed to update abuse state.', 500, error.message);
  }
}

function buildRateLimitError(endpoint, retryAfterSeconds, actorHash, reason = 'RATE_LIMIT') {
  return new RateLimitError('Too many requests. Please try again later.', {
    endpoint,
    retry_after_seconds: retryAfterSeconds,
    rate_limit_key: actorHash,
    reason
  });
}

function calculateBlockSeconds(policy, failureCount, reason) {
  const multiplier = reason === 'ABUSE_PATTERN'
    ? Math.min(Math.max(failureCount, 2), 6)
    : Math.min(Math.max(failureCount, 1), 4);
  return policy.blockSeconds * multiplier;
}

async function assertRateLimit(supabase, options) {
  const { endpoint, keys = [], requestId = null, traceId = null, action = endpoint, ip = 'unknown' } = options;
  const policy = getPolicy(endpoint);
  const now = new Date();
  const blockedStates = [];
  const evaluations = [];

  for (const rawKey of keys.filter(Boolean)) {
    const actorHash = hashValue(`${endpoint}|${rawKey}`);
    const state = await getState(supabase, actorHash, endpoint);
    if (state?.blocked_until && new Date(state.blocked_until) > now) {
      const retryAfterSeconds = Math.max(1, Math.ceil((new Date(state.blocked_until).getTime() - now.getTime()) / 1000));
      logger.warn(`${action} rate-limit-hit`, {
        action,
        outcome: 'rate_limited',
        request_id: requestId,
        trace_id: traceId || requestId,
        ip,
        rate_limit_key: actorHash,
        endpoint,
        reason: 'BLOCK_ACTIVE'
      });
      throw buildRateLimitError(endpoint, retryAfterSeconds, actorHash, 'BLOCK_ACTIVE');
    }

    const windowStart = bucketStartIso(policy.windowSeconds, now);
    const hits = await upsertCounter(supabase, { actorKey: actorHash, endpoint, windowStart, incrementBy: 1 });
    const failureCount = state?.failure_count || 0;
    const dynamicLimit = Math.max(1, policy.baseLimit - Math.min(failureCount, Math.floor(policy.baseLimit / 2)));
    const burstExceeded = hits > policy.burstLimit;
    const limitExceeded = hits > dynamicLimit;
    const abusePattern = failureCount >= policy.abuseFailures && hits >= policy.abuseHits;
    const reason = abusePattern ? 'ABUSE_PATTERN' : (burstExceeded ? 'BURST_LIMIT_EXCEEDED' : (limitExceeded ? 'THRESHOLD_EXCEEDED' : null));

    evaluations.push({ actorHash, hits, dynamicLimit, failureCount, reason });

    if (reason) {
      const nextFailureCount = failureCount + 1;
      const blockSeconds = calculateBlockSeconds(policy, nextFailureCount, reason);
      const blockedUntil = new Date(now.getTime() + blockSeconds * 1000).toISOString();
      blockedStates.push({
        actor_hash: actorHash,
        endpoint,
        failure_count: nextFailureCount,
        success_count: state?.success_count || 0,
        blocked_until: blockedUntil,
        last_seen_at: now.toISOString(),
        reason
      });
    }
  }

  for (const state of blockedStates) {
    await saveState(supabase, {
      actor_hash: state.actor_hash,
      endpoint: state.endpoint,
      failure_count: state.failure_count,
      success_count: state.success_count,
      blocked_until: state.blocked_until,
      last_seen_at: state.last_seen_at
    });
    logger.warn(`${action} rate-limit-hit`, {
      action,
      outcome: 'rate_limited',
      request_id: requestId,
      trace_id: traceId || requestId,
      ip,
      rate_limit_key: state.actor_hash,
      endpoint,
      reason: state.reason
    });
  }

  if (blockedStates.length > 0) {
    const first = blockedStates[0];
    const retryAfterSeconds = Math.max(1, Math.ceil((new Date(first.blocked_until).getTime() - now.getTime()) / 1000));
    throw buildRateLimitError(endpoint, retryAfterSeconds, first.actor_hash, first.reason);
  }

  return { endpoint, keys_checked: evaluations.length, policy };
}

async function registerRateLimitOutcome(supabase, options) {
  const { endpoint, keys = [], success, requestId = null, traceId = null, action = endpoint, ip = 'unknown' } = options;
  const nowIso = new Date().toISOString();
  const policy = getPolicy(endpoint);

  for (const rawKey of keys.filter(Boolean)) {
    const actorHash = hashValue(`${endpoint}|${rawKey}`);
    const state = await getState(supabase, actorHash, endpoint);
    const nextFailureCount = success ? 0 : Math.min((state?.failure_count || 0) + 1, 20);
    const nextSuccessCount = success ? (state?.success_count || 0) + 1 : (state?.success_count || 0);
    const abusePattern = !success && nextFailureCount >= policy.abuseFailures;
    const blockedUntil = abusePattern
      ? new Date(Date.now() + calculateBlockSeconds(policy, nextFailureCount, 'ABUSE_PATTERN') * 1000).toISOString()
      : null;

    await saveState(supabase, {
      actor_hash: actorHash,
      endpoint,
      failure_count: nextFailureCount,
      success_count: nextSuccessCount,
      blocked_until: blockedUntil,
      last_seen_at: nowIso
    });

    if (!success) {
      logger.warn(`${action} abuse-signal`, {
        action,
        outcome: 'failure',
        request_id: requestId,
        trace_id: traceId || requestId,
        ip,
        endpoint,
        rate_limit_key: actorHash,
        reason: abusePattern ? 'ABUSE_PATTERN' : 'FAILED_ATTEMPT'
      });
    }
  }
}

module.exports = {
  assertRateLimit,
  registerRateLimitOutcome,
  getPolicy
};
