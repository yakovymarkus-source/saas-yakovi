const { AppError } = require('./errors');

function getHeader(event, name) {
  if (!event?.headers || !name) return '';
  const target = String(name).toLowerCase();
  for (const [key, value] of Object.entries(event.headers)) {
    if (String(key).toLowerCase() === target) {
      return Array.isArray(value) ? String(value[0] || '') : String(value || '');
    }
  }
  return '';
}

function parseJsonBody(event, { fallback = {}, allowEmpty = true, errorCode = 'BAD_REQUEST', devMessage = 'Invalid JSON body' } = {}) {
  const rawBody = event?.body;
  if (rawBody == null || rawBody === '') {
    if (allowEmpty) return fallback;
    throw new AppError({
      code: errorCode,
      userMessage: 'גוף הבקשה חסר או לא תקין',
      devMessage,
      status: 400,
    });
  }

  if (typeof rawBody === 'object') {
    return rawBody;
  }

  try {
    return JSON.parse(rawBody);
  } catch (error) {
    throw new AppError({
      code: errorCode,
      userMessage: 'גוף הבקשה חייב להיות JSON תקין',
      devMessage: `${devMessage}: ${error.message}`,
      status: 400,
    });
  }
}

function requireField(value, fieldName, { location = 'body' } = {}) {
  if (value === undefined || value === null || value === '') {
    throw new AppError({
      code: 'BAD_REQUEST',
      userMessage: `חסר ${fieldName}`,
      devMessage: `Missing required field "${fieldName}" in ${location}`,
      status: 400,
    });
  }
  return value;
}

module.exports = { getHeader, parseJsonBody, requireField };
