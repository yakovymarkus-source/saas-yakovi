const { AppError, UnauthorizedError } = require('./errors');
const { getAdminClient } = require('./supabase');
const { getHeader } = require('./request');
const { logger } = require('./logger');

function resolveTraceId(event) {
  return getHeader(event, 'x-trace-id') || getHeader(event, 'x-nf-request-id') || getHeader(event, 'x-request-id') || 'unknown';
}

function extractToken(event) {
  const header = getHeader(event, 'authorization');
  if (!header) {
    throw new UnauthorizedError('Missing bearer token.');
  }

  const match = String(header).match(/^Bearer\s+(.+)$/i);
  if (!match || !match[1]) {
    throw new UnauthorizedError('Missing bearer token.');
  }

  const token = match[1].trim();
  if (!token) {
    throw new UnauthorizedError('Missing bearer token.');
  }

  return token;
}

async function verifySupabaseToken(token) {
  if (!token || typeof token !== 'string') {
    throw new UnauthorizedError('Invalid or expired session.');
  }

  const supabase = getAdminClient();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    throw new UnauthorizedError('Invalid or expired session.');
  }

  const user = data.user;
  if (user.banned_until || user.deleted_at || user.app_metadata?.account_status === 'deleted') {
    throw new AppError('ACCOUNT_DISABLED', 'This account is disabled.', 403);
  }

  return user;
}

async function requireUser(event) {
  const traceId = resolveTraceId(event);
  logger.info('auth.require-user attempt', {
    action: 'auth.require-user',
    request_id: traceId,
    trace_id: traceId,
    outcome: 'attempt',
    ip: getHeader(event, 'x-nf-client-connection-ip') || getHeader(event, 'x-forwarded-for') || 'unknown'
  });

  try {
    const token = extractToken(event);
    const user = await verifySupabaseToken(token);

    if (!user) {
      throw new UnauthorizedError('Invalid or expired session.');
    }

    logger.info('auth.require-user success', {
      action: 'auth.require-user',
      user_id: user.id,
      email: user.email || null,
      request_id: traceId,
      trace_id: traceId,
      outcome: 'success',
      ip: getHeader(event, 'x-nf-client-connection-ip') || getHeader(event, 'x-forwarded-for') || 'unknown'
    });

    return user;
  } catch (error) {
    logger.warn('auth.require-user failure', {
      action: 'auth.require-user',
      request_id: traceId,
      trace_id: traceId,
      outcome: 'failure',
      reason: error?.code || error?.message || 'UNAUTHORIZED',
      ip: getHeader(event, 'x-nf-client-connection-ip') || getHeader(event, 'x-forwarded-for') || 'unknown'
    });
    throw error;
  }
}

module.exports = {
  extractToken,
  verifySupabaseToken,
  requireUser
};
