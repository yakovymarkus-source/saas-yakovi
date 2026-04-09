'use strict';

// ─── Required — app cannot function without these ─────────────────────────────
const REQUIRED = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'APP_ENCRYPTION_KEY',
  'APP_URL',           // used by OAuth callbacks, billing redirects, and transactional emails
];

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function optionalEnv(name, fallback = '') {
  return process.env[name] || fallback;
}

/**
 * getEnv() — returns a validated snapshot of all env vars used by the app.
 *
 * Throws synchronously at invocation if any REQUIRED var is absent, so config
 * errors surface immediately rather than as runtime TypeErrors deep in call stacks.
 */
function getEnv() {
  const env = {};

  // Required
  for (const key of REQUIRED) env[key] = requireEnv(key);

  // ── Stripe ─────────────────────────────────────────────────────────────────
  // Optional at boot — missing Stripe vars degrade billing features gracefully.
  env.STRIPE_SECRET_KEY        = optionalEnv('STRIPE_SECRET_KEY');
  env.STRIPE_WEBHOOK_SECRET    = optionalEnv('STRIPE_WEBHOOK_SECRET');
  env.STRIPE_PRICE_STARTER     = optionalEnv('STRIPE_PRICE_STARTER');
  env.STRIPE_PRICE_PRO         = optionalEnv('STRIPE_PRICE_PRO');
  env.STRIPE_PRICE_AGENCY      = optionalEnv('STRIPE_PRICE_AGENCY');

  // ── Email (Resend) ──────────────────────────────────────────────────────────
  env.RESEND_API_KEY  = optionalEnv('RESEND_API_KEY');
  env.EMAIL_FROM      = optionalEnv('EMAIL_FROM',      'noreply@yourdomain.com');
  env.EMAIL_REPLY_TO  = optionalEnv('EMAIL_REPLY_TO',  '');
  env.ADMIN_EMAIL     = optionalEnv('ADMIN_EMAIL');

  // ── Google OAuth / Ads ──────────────────────────────────────────────────────
  env.GOOGLE_OAUTH_CLIENT_ID     = optionalEnv('GOOGLE_OAUTH_CLIENT_ID');
  env.GOOGLE_OAUTH_CLIENT_SECRET = optionalEnv('GOOGLE_OAUTH_CLIENT_SECRET');
  env.GOOGLE_ADS_DEVELOPER_TOKEN = optionalEnv('GOOGLE_ADS_DEVELOPER_TOKEN');

  // ── Meta ────────────────────────────────────────────────────────────────────
  env.META_APP_ID        = optionalEnv('META_APP_ID');
  env.META_APP_SECRET    = optionalEnv('META_APP_SECRET');
  env.META_GRAPH_VERSION = optionalEnv('META_GRAPH_VERSION', 'v19.0');
  env.META_PIXEL_ID      = optionalEnv('META_PIXEL_ID');
  env.FB_ACCESS_TOKEN    = optionalEnv('FB_ACCESS_TOKEN');
  env.META_API_VERSION   = optionalEnv('META_API_VERSION', 'v19.0');

  // ── Rate limiting & caching ─────────────────────────────────────────────────
  env.RATE_LIMIT_MAX            = Number(optionalEnv('RATE_LIMIT_MAX',            '60'));
  env.RATE_LIMIT_WINDOW_SECONDS = Number(optionalEnv('RATE_LIMIT_WINDOW_SECONDS', '60'));
  env.CACHE_TTL_SECONDS         = Number(optionalEnv('CACHE_TTL_SECONDS',         '2700'));
  env.STALE_CACHE_TTL_SECONDS   = Number(optionalEnv('STALE_CACHE_TTL_SECONDS',   '21600'));

  // ── Internal ────────────────────────────────────────────────────────────────
  env.HEALTH_SECRET              = optionalEnv('HEALTH_SECRET');
  env.SYNC_JOB_INTERNAL_SECRET   = optionalEnv('SYNC_JOB_INTERNAL_SECRET');
  env.ANALYSIS_VERSION           = optionalEnv('ANALYSIS_VERSION', '1.0.0');

  return env;
}

module.exports = { getEnv, requireEnv, optionalEnv };
