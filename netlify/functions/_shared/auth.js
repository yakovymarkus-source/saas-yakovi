const { AppError } = require('./errors');
const { getUserFromToken } = require('./supabase');
const { consumeRateLimit } = require('./rate-limit');
const { getEnv } = require('./env');
const { getHeader } = require('./request');

function extractBearerToken(event) {
  const header = getHeader(event, 'authorization');
  return header.replace(/^Bearer\s+/i, '').trim();
}

async function requireAuth(event, functionName, context) {
  const token = extractBearerToken(event);
  if (!token) {
    throw new AppError({ code: 'UNAUTHORIZED', userMessage: 'חסר token', devMessage: 'Missing bearer token', status: 401 });
  }
  const user = await getUserFromToken(token);
  await consumeRateLimit({ userId: user.id, ip: context.ip, functionName });
  return user;
}

async function requireAuthOrInternal(event, functionName, context) {
  const internalSecret = getHeader(event, 'x-internal-secret');
  const configuredSecret = getEnv().SYNC_JOB_INTERNAL_SECRET;

  if (configuredSecret && internalSecret) {
    if (internalSecret !== configuredSecret) {
      throw new AppError({ code: 'UNAUTHORIZED', userMessage: 'לא מורשה', devMessage: 'Invalid internal secret', status: 401 });
    }
    return { mode: 'internal', user: null };
  }

  if (internalSecret && !configuredSecret) {
    throw new AppError({ code: 'UNAUTHORIZED', userMessage: 'לא מורשה', devMessage: 'Internal secret is not configured', status: 401 });
  }

  const user = await requireAuth(event, functionName, context);
  return { mode: 'user', user };
}

module.exports = { extractBearerToken, requireAuth, requireAuthOrInternal };
