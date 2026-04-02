const { AppError } = require('./errors');

const state = global.__RATE_LIMIT_STATE__ || (global.__RATE_LIMIT_STATE__ = new Map());
const WINDOW_SECONDS = 60;
const MAX_REQUESTS = 120;

function buildScopeKey({ userId, ip, functionName }) {
  return [functionName || 'unknown', userId || 'anon', ip || 'unknown'].join(':');
}

async function consumeRateLimit({ userId, ip, functionName } = {}) {
  const scopeKey = buildScopeKey({ userId, ip, functionName });
  const now = Date.now();
  const windowMs = WINDOW_SECONDS * 1000;
  const currentWindowStart = Math.floor(now / windowMs) * windowMs;
  const existing = state.get(scopeKey);
  const entry = (!existing || existing.windowStartedAt !== currentWindowStart)
    ? { windowStartedAt: currentWindowStart, requestCount: 0 }
    : existing;

  entry.requestCount += 1;
  state.set(scopeKey, entry);

  if (entry.requestCount > MAX_REQUESTS) {
    const retryAfterSeconds = Math.max(1, Math.ceil((currentWindowStart + windowMs - now) / 1000));
    throw new AppError({
      code: 'RATE_LIMITED',
      userMessage: 'יש יותר מדי בקשות. נסה שוב בעוד רגע.',
      devMessage: `Rate limit exceeded for ${scopeKey}`,
      status: 429,
      details: { scopeKey, retryAfterSeconds },
    });
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

module.exports = { consumeRateLimit };
