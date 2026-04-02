const { AppError } = require('./errors');

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new AppError('MISSING_ENV', `Missing environment variable: ${name}`, 500);
  }
  return value;
}

function optional(name, fallback = null) {
  const value = process.env[name];
  if (value === undefined || value === null || value === '') return fallback;
  return value;
}

function numberEnv(name, fallback) {
  const value = optional(name, null);
  if (value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new AppError('INVALID_ENV', `Environment variable ${name} must be numeric.`, 500);
  }
  return parsed;
}

function loadEnv() {
  return Object.freeze({
    supabaseUrl: required('SUPABASE_URL'),
    supabaseAnonKey: required('SUPABASE_ANON_KEY'),
    supabaseServiceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
    siteUrl: optional('SITE_URL', ''),
    rateLimitPerMinute: numberEnv('ACCOUNT_RATE_LIMIT_PER_MINUTE', 15),
    historyPageSize: numberEnv('ACCOUNT_HISTORY_PAGE_SIZE', 25)
  });
}

module.exports = {
  loadEnv
};
