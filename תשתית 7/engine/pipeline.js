const crypto = require('node:crypto');
const { fetchAllData } = require('./dataFetcher');
const { normalizeFetchedBundle } = require('./dataNormalizer');
const { validateOutput } = require('./schemaValidator');
const { MemoryCache } = require('./cache');
const { DOMAIN_SCHEMA_VERSION } = require('./domainSchema');
const { createObservationContext } = require('./observability');

const sharedCache = new MemoryCache();

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function buildCacheKey(input) {
  return crypto.createHash('sha1').update(stableStringify(input)).digest('hex');
}

async function runPipeline(input = {}, options = {}) {
  const startedAt = Date.now();
  const request_id = options.request_id || `req_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  const observer = createObservationContext({ request_id, cache_hit: false, retry_count: 0, status: 'ok' }, options.logger);
  const cacheKey = buildCacheKey(input);
  const ttlMs = Number.isFinite(input.cacheTtlMs) ? Math.max(0, input.cacheTtlMs) : 60000;

  const cached = await sharedCache.get(cacheKey);
  if (cached) {
    const response = {
      ...cached,
      request_id,
      cache_hit: true,
      duration_ms: Date.now() - startedAt,
      generated_at: new Date().toISOString()
    };
    validateOutput(response);
    observer.info('pipeline_cache_hit', {
      cache_hit: true,
      retry_count: response.retry_count,
      status: response.status
    });
    return response;
  }

  try {
    const fetched = await fetchAllData(input, { request_id, logger: observer, runtimeConfig: options.runtimeConfig });
    const normalized = normalizeFetchedBundle(fetched);
    const response = {
      schema_version: DOMAIN_SCHEMA_VERSION,
      request_id,
      generated_at: new Date().toISOString(),
      cache_hit: false,
      duration_ms: Date.now() - startedAt,
      retry_count: normalized.retry_count,
      status: normalized.status,
      providers: normalized.providers,
      summary: normalized.summary
    };

    validateOutput(response);
    await sharedCache.set(cacheKey, response, ttlMs);
    observer.info('pipeline_completed', {
      cache_hit: false,
      retry_count: response.retry_count,
      status: response.status
    });
    return response;
  } catch (error) {
    observer.error('pipeline_failed', {
      cache_hit: false,
      retry_count: 0,
      status: 'error',
      error: error.message
    });
    throw error;
  }
}

module.exports = {
  runPipeline,
  sharedCache,
  buildCacheKey
};
