'use strict';

const { requireAuth }   = require('./auth');
const { getAdminClient }= require('./supabase');
const { AppError }      = require('./errors');

/**
 * Verify the request carries a valid user JWT AND that the user has
 * is_admin = true in the profiles table.
 *
 * Admin endpoints deliberately skip per-user rate limiting — the admin
 * dashboard is an internal operator tool, not a public API.
 *
 * @returns {object} Supabase user object (same as requireAuth)
 */
async function requireAdmin(event, functionName, context) {
  const user = await requireAuth(event, functionName, context);

  const { data, error } = await getAdminClient()
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .maybeSingle();

  if (error) {
    throw new AppError({
      code:        'DB_READ_FAILED',
      userMessage: 'Admin verification failed',
      devMessage:  `profiles.is_admin read error for ${user.id}: ${error.message}`,
      status:      500,
    });
  }

  if (!data?.is_admin) {
    throw new AppError({
      code:        'FORBIDDEN',
      userMessage: 'Admin access required',
      devMessage:  `User ${user.id} is not an admin`,
      status:      403,
    });
  }

  return user;
}

module.exports = { requireAdmin };
