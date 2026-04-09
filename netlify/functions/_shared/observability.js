const crypto = require('node:crypto');
const { getHeader } = require('./request');

function createRequestContext(event, functionName) {
  const startedAt = Date.now();
  const correlationId = getHeader(event, 'x-correlation-id') || crypto.randomUUID();
  return {
    requestId: crypto.randomUUID(),
    correlationId,
    functionName,
    startedAt,
    ip: getHeader(event, 'x-forwarded-for') || event?.requestContext?.identity?.sourceIp || '',
    userAgent: getHeader(event, 'user-agent') || '',
  };
}

function buildLogPayload(context, level, message, metadata = {}) {
  return {
    request_id: context.requestId,
    correlation_id: context.correlationId,
    function_name: context.functionName,
    level,
    message,
    ip: context.ip,
    user_agent: context.userAgent,
    duration_ms: Math.max(0, Date.now() - context.startedAt),
    metadata,
  };
}

module.exports = { createRequestContext, buildLogPayload };
