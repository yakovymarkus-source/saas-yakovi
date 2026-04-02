const { AppError } = require('./errors');
const { baseHeaders, buildMeta, successResponse, errorResponse } = require('./response');
const { logger } = require('./logger');
const { buildTraceMeta } = require('./request');

function createHandler({ name, method, allowMethods = null, auth = false, handler }) {
  return async (event, context) => {
    const trace = buildTraceMeta(event, context);
    const timestamp = new Date().toISOString();
    const meta = buildMeta({ requestId: trace.requestId, traceId: trace.traceId, timestamp });
    const requestLog = {
      action: name,
      outcome: 'request',
      request_id: trace.requestId,
      trace_id: trace.traceId,
      ip: trace.ip,
      method: event.httpMethod,
      path: event.path,
      auth_required: Boolean(auth)
    };

    try {
      const allowed = allowMethods || (method ? [method] : null);
      if (allowed && !allowed.includes(event.httpMethod)) {
        throw new AppError('METHOD_NOT_ALLOWED', 'Method not allowed.', 405, {
          allowed_methods: allowed
        });
      }

      logger.info(`${name} request`, requestLog);
      const result = await handler(event, context, { ...trace, meta });
      const statusCode = result?.statusCode || 200;
      const headers = baseHeaders({
        'X-Request-Id': trace.requestId,
        'X-Trace-Id': trace.traceId,
        ...(result?.headers || {})
      });

      if (result && Object.prototype.hasOwnProperty.call(result, 'body')) {
        return {
          statusCode,
          headers,
          body: result.body
        };
      }

      return {
        ...successResponse(statusCode, result?.data ?? null, meta, headers)
      };
    } catch (error) {
      logger.error(`${name} failed`, {
        action: name,
        outcome: 'failure',
        request_id: trace.requestId,
        trace_id: trace.traceId,
        ip: trace.ip,
        reason: error?.code || error?.message || 'UNKNOWN_ERROR',
        error
      });

      return errorResponse(error, meta, {
        'X-Request-Id': trace.requestId,
        'X-Trace-Id': trace.traceId
      });
    }
  };
}

module.exports = {
  createHandler
};
