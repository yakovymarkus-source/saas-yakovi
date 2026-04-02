const API_VERSION = '2026-03-31';

function baseHeaders(extra = {}) {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extra
  };
}

function buildMeta({ requestId = null, traceId = null, timestamp = null, version = API_VERSION } = {}) {
  return {
    requestId,
    trace_id: traceId || requestId || null,
    timestamp: timestamp || new Date().toISOString(),
    version
  };
}

function successEnvelope(data, meta) {
  return {
    ok: true,
    data,
    error: null,
    meta
  };
}

function errorEnvelope(error, meta) {
  return {
    ok: false,
    data: null,
    error: {
      code: error?.code || 'INTERNAL_ERROR',
      message: error?.message || 'Unexpected server error.'
    },
    meta
  };
}

function successResponse(statusCode, data, meta, extraHeaders = {}) {
  return {
    statusCode,
    headers: baseHeaders(extraHeaders),
    body: JSON.stringify(successEnvelope(data, meta))
  };
}

function errorResponse(error, meta, extraHeaders = {}) {
  return {
    statusCode: error?.statusCode || 500,
    headers: baseHeaders(extraHeaders),
    body: JSON.stringify(errorEnvelope(error, meta))
  };
}

module.exports = {
  API_VERSION,
  baseHeaders,
  buildMeta,
  successResponse,
  errorResponse,
  successEnvelope,
  errorEnvelope
};
