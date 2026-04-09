'use strict';

const { toAppError } = require('./errors');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  'https://campaignbrain.netlify.app',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Request-ID',
  'Access-Control-Max-Age':       '86400',
};

function respond(statusCode, payload, requestId, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...CORS_HEADERS,
      ...(requestId ? { 'x-request-id': requestId } : {}),
      ...extraHeaders,
    },
    body: JSON.stringify(payload),
  };
}

/**
 * options() — respond to CORS preflight (OPTIONS) requests.
 * Call this at the top of every handler before any auth logic.
 */
function options() {
  return {
    statusCode: 204,
    headers: { ...CORS_HEADERS },
    body: '',
  };
}

function ok(data, requestId, headers) {
  return respond(200, { ok: true, data }, requestId, headers);
}

function accepted(data, requestId, headers) {
  return respond(202, { ok: true, data }, requestId, headers);
}

function fail(error, requestId, headers) {
  const appError = toAppError(error);
  return respond(appError.status || 500, {
    ok: false,
    code: appError.code,
    message: appError.userMessage,
    requestId,
  }, requestId, headers);
}

module.exports = { respond, ok, accepted, fail, options, CORS_HEADERS };
