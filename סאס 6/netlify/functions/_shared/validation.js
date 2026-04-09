/**
 * validation.js — Centralised deep input validation
 *
 * Every public-facing endpoint MUST call the relevant validator before
 * touching business logic.  Validators throw AppError(400) on failure
 * so callers never receive malformed data.
 */

const { AppError } = require('./errors');

// ─── Primitives ───────────────────────────────────────────────────────────────

const UUID_RE   = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE  = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DATE_RE   = /^\d{4}-\d{2}-\d{2}$/;
const SLUG_RE   = /^[a-zA-Z0-9_\-]{1,128}$/;

function fail(field, msg) {
  throw new AppError({
    code:        'VALIDATION_ERROR',
    userMessage: `קלט לא תקין: ${field}`,
    devMessage:  `Validation failed for "${field}": ${msg}`,
    status:      400,
    details:     { field },
  });
}

// ─── Type validators ──────────────────────────────────────────────────────────

function isUuid(value, field) {
  if (typeof value !== 'string' || !UUID_RE.test(value)) fail(field, 'must be a valid UUID v4');
  return value;
}

function isEmail(value, field) {
  if (typeof value !== 'string' || !EMAIL_RE.test(value.trim())) fail(field, 'must be a valid email address');
  return value.trim().toLowerCase();
}

function isNonEmptyString(value, field, { max = 2048 } = {}) {
  if (typeof value !== 'string' || value.trim().length === 0) fail(field, 'must be a non-empty string');
  if (value.length > max) fail(field, `must be ${max} characters or fewer`);
  return value.trim();
}

function isSlug(value, field) {
  if (typeof value !== 'string' || !SLUG_RE.test(value)) fail(field, 'must contain only letters, numbers, _ or -');
  return value;
}

function isIsoDate(value, field) {
  if (typeof value !== 'string' || !DATE_RE.test(value) || isNaN(Date.parse(value))) {
    fail(field, 'must be a date in YYYY-MM-DD format');
  }
  return value;
}

function isPositiveInt(value, field, { max = 1_000_000 } = {}) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > max) fail(field, `must be a positive integer ≤ ${max}`);
  return n;
}

function isEnum(value, field, allowed) {
  if (!allowed.includes(value)) fail(field, `must be one of: ${allowed.join(', ')}`);
  return value;
}

function isOptionalString(value, field, { max = 2048 } = {}) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') fail(field, 'must be a string if provided');
  if (value.length > max) fail(field, `must be ${max} characters or fewer`);
  return value.trim() || null;
}

function isObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(field, 'must be an object');
  return value;
}

// ─── Composite validators for each endpoint ───────────────────────────────────

function validateEnqueueSyncJob(body) {
  return {
    campaignId:      isNonEmptyString(body.campaignId, 'campaignId', { max: 128 }),
    idempotencyKey:  isOptionalString(body.idempotencyKey, 'idempotencyKey', { max: 128 }),
    startDate:       body.startDate ? isIsoDate(body.startDate, 'startDate') : null,
    endDate:         body.endDate   ? isIsoDate(body.endDate,   'endDate')   : null,
  };
}

function validateAccountProfile(body) {
  const out = {};
  if (Object.prototype.hasOwnProperty.call(body, 'name')) {
    out.name = isOptionalString(body.name, 'name', { max: 100 });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'email')) {
    out.email = isEmail(body.email, 'email');
  }
  if (Object.prototype.hasOwnProperty.call(body, 'avatarUrl')) {
    out.avatarUrl = isOptionalString(body.avatarUrl, 'avatarUrl', { max: 512 });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'preferences')) {
    out.preferences = isObject(body.preferences, 'preferences');
  }
  return out;
}

function validateBillingCheckout(body) {
  return {
    priceId: isNonEmptyString(body.priceId, 'priceId', { max: 64 }),
  };
}

function validateIntegrationConnect(body) {
  const PROVIDERS = ['ga4', 'meta', 'google_ads'];
  return {
    provider:   isEnum(body.provider, 'provider', PROVIDERS),
    secret:     isObject(body.secret, 'secret'),
    accountId:  isOptionalString(body.accountId,  'accountId',  { max: 64 }),
    propertyId: isOptionalString(body.propertyId, 'propertyId', { max: 64 }),
    metadata:   body.metadata ? isObject(body.metadata, 'metadata') : {},
  };
}

function validateCreateCampaign(body) {
  return {
    name: sanitiseText(isNonEmptyString(body.name, 'name', { max: 200 })),
  };
}

function validatePaymentPending(body) {
  // Only these plans are available via manual GrowLink payment
  const ALLOWED = ['early_bird', 'pro'];
  return {
    plan: isEnum(body.plan || 'early_bird', 'plan', ALLOWED),
  };
}

function validateGdprExport(_body) {
  // No body fields required; user is always derived from token
  return {};
}

function validateAccountDelete(body) {
  if (body.confirmation !== 'DELETE') {
    throw new AppError({
      code:        'DELETE_CONFIRMATION_REQUIRED',
      userMessage: 'כדי למחוק חשבון, יש להקליד DELETE בדיוק.',
      devMessage:  'Missing or incorrect deletion confirmation',
      status:      400,
    });
  }
  return { confirmation: 'DELETE' };
}

// ─── SQL-injection / XSS defence (belt-and-suspenders) ───────────────────────
// Supabase SDK uses parameterised queries, but we still strip dangerous chars
// from any free-text fields that end up in logs or user-facing output.

const DANGEROUS_RE = /<script|on\w+\s*=|javascript:|data:/i;

function sanitiseText(value) {
  if (typeof value !== 'string') return value;
  if (DANGEROUS_RE.test(value)) {
    throw new AppError({
      code:        'INVALID_INPUT',
      userMessage: 'הקלט מכיל תווים לא מותרים',
      devMessage:  'Potential XSS pattern detected in input',
      status:      400,
    });
  }
  return value;
}

module.exports = {
  isUuid, isEmail, isNonEmptyString, isSlug, isIsoDate,
  isPositiveInt, isEnum, isOptionalString, isObject,
  sanitiseText,
  validateCreateCampaign,
  validatePaymentPending,
  validateEnqueueSyncJob,
  validateAccountProfile,
  validateBillingCheckout,
  validateIntegrationConnect,
  validateGdprExport,
  validateAccountDelete,
};
