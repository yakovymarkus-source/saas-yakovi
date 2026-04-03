const { runPipeline } = require('../../engine/pipeline');
const { AppError, toPublicError } = require('./_shared/errors');

function parseBody(event = {}) {
  if (!event.body) return {};
  if (typeof event.body === 'object') return event.body;
  try {
    return JSON.parse(event.body);
  } catch (error) {
    throw new AppError('INVALID_JSON', 'Request body must be valid JSON.', 400);
  }
}

exports.handler = async function handler(event = {}) {
  try {
    if ((event.httpMethod || 'POST').toUpperCase() !== 'POST') {
      throw new AppError('METHOD_NOT_ALLOWED', 'Only POST is allowed.', 405);
    }

    const input = parseBody(event);
    const result = await runPipeline(input, {});

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ success: true, data: result })
    };
  } catch (error) {
    const publicError = toPublicError(error);
    return {
      statusCode: publicError.statusCode,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(publicError.body)
    };
  }
};
