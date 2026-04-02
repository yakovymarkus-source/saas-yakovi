const { createInfrastructureLogger } = require('./infrastructureLogger');

function createObservationContext(base = {}, logger = console) {
  const infraLogger = createInfrastructureLogger(logger);
  const startedAt = Date.now();
  const context = {
    request_id: base.request_id || `req_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    cache_hit: Boolean(base.cache_hit),
    retry_count: Number.isInteger(base.retry_count) ? base.retry_count : 0,
    status: base.status || 'ok',
    startedAt
  };

  function emit(level, message, extra = {}) {
    const duration = Date.now() - startedAt;
    const payload = {
      request_id: context.request_id,
      cache_hit: Boolean(extra.cache_hit ?? context.cache_hit),
      retry_count: Number.isInteger(extra.retry_count) ? extra.retry_count : context.retry_count,
      duration,
      status: extra.status || context.status,
      ...extra
    };
    (infraLogger[level] || infraLogger.info)(message, payload);
    return payload;
  }

  return {
    context,
    info(message, extra) {
      return emit('info', message, extra);
    },
    warn(message, extra) {
      return emit('warn', message, extra);
    },
    error(message, extra) {
      return emit('error', message, extra);
    }
  };
}

module.exports = {
  createObservationContext
};
