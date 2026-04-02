const crypto = require('crypto');
const { AppError } = require('./errors');

function getHeader(event, name) {
  const headers = event?.headers || {};
  return headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()] || null;
}

function getClientIp(event) {
  const direct = getHeader(event, 'x-nf-client-connection-ip') || getHeader(event, 'x-forwarded-for') || '';
  const value = String(direct).split(',')[0].trim();
  return value || 'unknown';
}

function hashValue(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function getActorKey({ userId = null, email = null, event = null, scope = 'global' } = {}) {
  if (userId) return `user:${userId}:${scope}`;
  const parts = [scope];
  if (email) parts.push(`email:${normalizeEmail(email)}`);
  if (event) parts.push(`ip:${getClientIp(event)}`);
  return `anon:${hashValue(parts.join('|'))}`;
}

function parseJson(event) {
  if (!event.body) return {};
  try {
    return JSON.parse(event.body);
  } catch (_) {
    throw new AppError('INVALID_JSON', 'Invalid JSON body.', 400);
  }
}

function buildTraceMeta(event, context) {
  const requestId = getHeader(event, 'x-nf-request-id') || getHeader(event, 'x-request-id') || context?.awsRequestId || crypto.randomUUID();
  const traceId = getHeader(event, 'x-trace-id') || requestId;
  return {
    requestId,
    traceId,
    ip: getClientIp(event),
    userAgent: getHeader(event, 'user-agent') || 'unknown'
  };
}

module.exports = {
  getHeader,
  getClientIp,
  getActorKey,
  normalizeEmail,
  parseJson,
  buildTraceMeta,
  hashValue
};
