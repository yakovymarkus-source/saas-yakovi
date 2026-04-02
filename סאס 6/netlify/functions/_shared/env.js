const REQUIRED = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'APP_ENCRYPTION_KEY'];

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name, fallback = '') {
  return process.env[name] || fallback;
}

function getEnv() {
  const env = {};
  for (const key of REQUIRED) env[key] = requireEnv(key);
  env.META_GRAPH_VERSION = optionalEnv('META_GRAPH_VERSION', 'v19.0');
  env.RATE_LIMIT_MAX = Number(optionalEnv('RATE_LIMIT_MAX', 60));
  env.RATE_LIMIT_WINDOW_SECONDS = Number(optionalEnv('RATE_LIMIT_WINDOW_SECONDS', 60));
  env.CACHE_TTL_SECONDS = Number(optionalEnv('CACHE_TTL_SECONDS', 2700));
  env.STALE_CACHE_TTL_SECONDS = Number(optionalEnv('STALE_CACHE_TTL_SECONDS', 21600));
  env.GOOGLE_ADS_DEVELOPER_TOKEN = optionalEnv('GOOGLE_ADS_DEVELOPER_TOKEN');
  env.GOOGLE_OAUTH_CLIENT_ID = optionalEnv('GOOGLE_OAUTH_CLIENT_ID');
  env.GOOGLE_OAUTH_CLIENT_SECRET = optionalEnv('GOOGLE_OAUTH_CLIENT_SECRET');
  env.ANALYSIS_VERSION = optionalEnv('ANALYSIS_VERSION', '1.0.0');
  env.HEALTH_SECRET = optionalEnv('HEALTH_SECRET');
  env.SYNC_JOB_INTERNAL_SECRET = optionalEnv('SYNC_JOB_INTERNAL_SECRET');
  return env;
}

module.exports = { getEnv, requireEnv, optionalEnv };
