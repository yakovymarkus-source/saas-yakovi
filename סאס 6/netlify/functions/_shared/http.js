const { toAppError } = require('./errors');

function respond(statusCode, payload, requestId, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(requestId ? { 'x-request-id': requestId } : {}),
      ...extraHeaders,
    },
    body: JSON.stringify(payload),
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

module.exports = { respond, ok, accepted, fail };
