const { AppError } = require('../netlify/functions/_shared/errors');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(options = {}) {
  const {
    execute,
    retries = 0,
    retryBaseDelayMs = 25,
    retryMaxDelayMs = 250,
    logger,
    request_id
  } = options;

  if (typeof execute !== 'function') {
    throw new AppError('HTTP_EXECUTOR_REQUIRED', 'httpClient.request requires an execute function.', 500);
  }

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await execute();
      return { data: response, retry_count: attempt, request_id };
    } catch (error) {
      lastError = error;
      if (logger?.warn) {
        logger.warn('http_request_retry', {
          request_id,
          cache_hit: false,
          retry_count: attempt,
          duration: 0,
          status: 'retrying',
          error: error.message
        });
      }
      if (attempt < retries) {
        const delay = Math.min(retryBaseDelayMs * (2 ** attempt), retryMaxDelayMs);
        await wait(delay);
      }
    }
  }

  throw new AppError('HTTP_REQUEST_FAILED', lastError?.message || 'HTTP request failed.', 502, {
    request_id,
    cause: lastError?.message || null
  });
}

module.exports = {
  request
};
