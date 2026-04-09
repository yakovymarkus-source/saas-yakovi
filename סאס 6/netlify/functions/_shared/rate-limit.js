'use strict';

const { AppError } = require('./errors');

const state = global.__RATE_LIMIT_STATE__ || (global.__RATE_LIMIT_STATE__ = new Map());

// Default: 60 requests per minute per (function, user/ip)
const DEFAULT_WINDOW_SECONDS = 60;
const DEFAULT_MAX_REQUESTS   = 60;

// Strict mode for AI and billing endpoints: 30 requests per minute
const STRICT_MAX_REQUESTS = 30;

// Per-function overrides — functions listed here use STRICT limit
const STRICT_FUNCTIONS = new Set([
  'campaigner-chat',
  'enqueue-sync-job',
  'billing-checkout',
  'billing-portal',
  'payment-pending',
  'ad-copy-generator',
]);

function buildScopeKey({ userId, ip, functionName }) {
  return [functionName || 'unknown', userId || 'anon', ip || 'unknown'].join(':');
}

async function consumeRateLimit({ userId, ip, functionName } = {}) {
  const scopeKey   = buildScopeKey({ userId, ip, functionName });
  const maxRequests = STRICT_FUNCTIONS.has(functionName)
    ? STRICT_MAX_REQUESTS
    : DEFAULT_MAX_REQUESTS;

  const now              = Date.now();
  const windowMs         = DEFAULT_WINDOW_SECONDS * 1000;
  const currentWindowStart = Math.floor(now / windowMs) * windowMs;
  const existing         = state.get(scopeKey);

  const entry = (!existing || existing.windowStartedAt !== currentWindowStart)
    ? { windowStartedAt: currentWindowStart, requestCount: 0 }
    : existing;

  entry.requestCount += 1;
  state.set(scopeKey, entry);

  if (entry.requestCount > maxRequests) {
    const retryAfterSeconds = Math.max(1, Math.ceil((currentWindowStart + windowMs - now) / 1000));
    throw new AppError({
      code:        'RATE_LIMITED',
      userMessage: 'יש יותר מדי בקשות. נסה שוב בעוד רגע.',
      devMessage:  `Rate limit exceeded for ${scopeKey} (${entry.requestCount}/${maxRequests})`,
      status:      429,
      details:     { scopeKey, retryAfterSeconds },
    });
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

module.exports = { consumeRateLimit };
