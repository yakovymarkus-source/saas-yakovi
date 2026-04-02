const { createClient } = require('@supabase/supabase-js');
const { loadEnv } = require('./env');

function createBaseClient(key, globalHeaders = {}) {
  const env = loadEnv();
  return createClient(env.supabaseUrl, key, {
    global: { headers: globalHeaders },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false
    }
  });
}

function getAdminClient() {
  const env = loadEnv();
  return createBaseClient(env.supabaseServiceRoleKey);
}

function getAnonClient() {
  const env = loadEnv();
  return createBaseClient(env.supabaseAnonKey);
}

function getUserScopedClient(accessToken) {
  const env = loadEnv();
  return createBaseClient(env.supabaseAnonKey, {
    Authorization: `Bearer ${accessToken}`
  });
}

module.exports = {
  getAdminClient,
  getAnonClient,
  getUserScopedClient
};
