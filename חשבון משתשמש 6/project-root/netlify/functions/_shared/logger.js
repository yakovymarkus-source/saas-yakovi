function sanitizeMeta(meta = {}) {
  const out = {};
  for (const [key, value] of Object.entries(meta || {})) {
    if (value === undefined) continue;
    if (/password|token|authorization|secret/i.test(key)) {
      out[key] = '[redacted]';
      continue;
    }
    if (value instanceof Error) {
      out[key] = {
        name: value.name,
        message: value.message,
        code: value.code,
        statusCode: value.statusCode
      };
      continue;
    }
    out[key] = value;
  }

  if (!Object.prototype.hasOwnProperty.call(out, 'request_id') && Object.prototype.hasOwnProperty.call(out, 'requestId')) {
    out.request_id = out.requestId;
    delete out.requestId;
  }

  if (!Object.prototype.hasOwnProperty.call(out, 'trace_id')) {
    if (Object.prototype.hasOwnProperty.call(out, 'traceId')) {
      out.trace_id = out.traceId;
      delete out.traceId;
    } else if (Object.prototype.hasOwnProperty.call(out, 'request_id')) {
      out.trace_id = out.request_id;
    }
  }

  return out;
}

function write(level, message, meta = {}) {
  const payload = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...sanitizeMeta(meta)
  };
  const line = JSON.stringify(payload);
  if (level === 'error' || level === 'warn') {
    console.error(line);
    return;
  }
  console.log(line);
}

const logger = {
  info(message, meta) {
    write('info', message, meta);
  },
  warn(message, meta) {
    write('warn', message, meta);
  },
  error(message, meta) {
    write('error', message, meta);
  }
};

module.exports = {
  logger
};
