const { createClient } = require('@supabase/supabase-js');
const { requireEnv } = require('./env');
const { AppError } = require('./errors');

let _adminClient = null;

function getAdminClient() {
  // In tests, allow injection via global
  if (global.__TEST_SUPABASE_CLIENT__) return global.__TEST_SUPABASE_CLIENT__;

  if (!_adminClient) {
    const url = requireEnv('SUPABASE_URL');
    const key = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
    _adminClient = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _adminClient;
}

async function getUserFromToken(token) {
  const client = getAdminClient();
  const { data: { user }, error } = await client.auth.getUser(token);
  if (error || !user) {
    throw new AppError({
      code: 'UNAUTHORIZED',
      userMessage: 'לא מורשה',
      devMessage: error?.message || 'Invalid or expired token',
      status: 401,
    });
  }
  return user;
}

async function writeRequestLog(payload) {
  try {
    const client = getAdminClient();
    const { error } = await client.from('request_logs').insert(payload);
    if (error) throw error;
  } catch (_) {
    // Non-critical — never block the response
  }
}

module.exports = { getAdminClient, getUserFromToken, writeRequestLog };
