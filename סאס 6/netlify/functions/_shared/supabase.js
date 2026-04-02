const { AppError } = require('./errors');

function getClientFromGlobal() {
  return global.__TEST_SUPABASE_CLIENT__ || null;
}

function getAdminClient() {
  const client = getClientFromGlobal();
  if (!client) {
    throw new AppError({
      code: 'SUPABASE_NOT_CONFIGURED',
      userMessage: 'שירות הנתונים לא מוגדר',
      devMessage: 'Supabase client not configured',
      status: 500,
    });
  }
  return client;
}

async function getUserFromToken(token) {
  const client = getClientFromGlobal();
  if (client?.auth?.getUserFromToken) return client.auth.getUserFromToken(token);
  throw new AppError({ code: 'UNAUTHORIZED', userMessage: 'לא מורשה', devMessage: 'Token validation is unavailable', status: 401 });
}

async function writeRequestLog(payload) {
  const client = getClientFromGlobal();
  if (client?.writeRequestLog) return client.writeRequestLog(payload);
  if (client?.from) {
    const query = client.from('request_logs');
    if (query?.insert) {
      const result = await query.insert(payload);
      if (result?.error) throw result.error;
      return result.data || null;
    }
  }
  return null;
}

module.exports = { getAdminClient, getUserFromToken, writeRequestLog };
