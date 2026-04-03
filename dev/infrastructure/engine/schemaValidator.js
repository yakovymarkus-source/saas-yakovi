const { AppError } = require('../netlify/functions/_shared/errors');
const { outputSchema } = require('./domainSchema');

function isIsoDate(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function validatePrimitive(rule, value, path) {
  if (rule.required && (value === undefined || value === null)) {
    throw new AppError('SCHEMA_VALIDATION_ERROR', `Missing required field: ${path}`, 500, { path });
  }

  if (value === undefined || value === null) return;

  switch (rule.type) {
    case 'string':
      if (typeof value !== 'string') {
        throw new AppError('SCHEMA_VALIDATION_ERROR', `Expected string at ${path}`, 500, { path, value });
      }
      if (rule.minLength && value.length < rule.minLength) {
        throw new AppError('SCHEMA_VALIDATION_ERROR', `String too short at ${path}`, 500, { path, value });
      }
      if (rule.equals && value !== rule.equals) {
        throw new AppError('SCHEMA_VALIDATION_ERROR', `Invalid value at ${path}`, 500, { path, value, expected: rule.equals });
      }
      if (rule.enum && !rule.enum.includes(value)) {
        throw new AppError('SCHEMA_VALIDATION_ERROR', `Unexpected enum value at ${path}`, 500, { path, value, expected: rule.enum });
      }
      if (rule.isoDate && !isIsoDate(value)) {
        throw new AppError('SCHEMA_VALIDATION_ERROR', `Invalid ISO date at ${path}`, 500, { path, value });
      }
      return;
    case 'number':
      if (typeof value !== 'number' || Number.isNaN(value)) {
        throw new AppError('SCHEMA_VALIDATION_ERROR', `Expected number at ${path}`, 500, { path, value });
      }
      if (rule.finite && !Number.isFinite(value)) {
        throw new AppError('SCHEMA_VALIDATION_ERROR', `Expected finite number at ${path}`, 500, { path, value });
      }
      if (rule.integer && !Number.isInteger(value)) {
        throw new AppError('SCHEMA_VALIDATION_ERROR', `Expected integer at ${path}`, 500, { path, value });
      }
      if (rule.min !== undefined && value < rule.min) {
        throw new AppError('SCHEMA_VALIDATION_ERROR', `Number below minimum at ${path}`, 500, { path, value, min: rule.min });
      }
      return;
    case 'boolean':
      if (typeof value !== 'boolean') {
        throw new AppError('SCHEMA_VALIDATION_ERROR', `Expected boolean at ${path}`, 500, { path, value });
      }
      return;
    case 'object':
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new AppError('SCHEMA_VALIDATION_ERROR', `Expected object at ${path}`, 500, { path, value });
      }
      validateFields(rule.fields || {}, value, path);
      return;
    case 'array':
      if (!Array.isArray(value)) {
        throw new AppError('SCHEMA_VALIDATION_ERROR', `Expected array at ${path}`, 500, { path, value });
      }
      value.forEach((item, index) => validateRule(rule.items, item, `${path}[${index}]`));
      return;
    default:
      throw new AppError('SCHEMA_VALIDATION_ERROR', `Unknown schema type at ${path}`, 500, { path, type: rule.type });
  }
}

function validateFields(fields, value, path) {
  for (const [field, rule] of Object.entries(fields)) {
    validateRule(rule, value[field], `${path}.${field}`);
  }
}

function validateRule(rule, value, path) {
  validatePrimitive(rule, value, path);
}

function validateOutput(payload) {
  validateRule({ type: 'object', required: true, fields: outputSchema }, payload, 'output');
  return payload;
}

module.exports = {
  validateOutput
};
