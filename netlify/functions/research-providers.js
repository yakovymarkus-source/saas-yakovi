'use strict';
require('./_shared/env');

const { ok, fail, options } = require('./_shared/http');
const { requireAuth }       = require('./_shared/auth');
const { parseJsonBody }     = require('./_shared/request');
const { getAdminClient }    = require('./_shared/supabase');

/**
 * Admin endpoint for managing data source providers.
 *
 * GET    /research-providers          — list all providers
 * POST   /research-providers          — create custom provider
 * PUT    /research-providers?id=X     — update provider config/active status
 * DELETE /research-providers?id=X     — delete non-builtin provider
 */

async function isAdmin(userId) {
  const { data } = await getAdminClient()
    .from('profiles')
    .select('is_admin')
    .eq('id', userId)
    .single();
  return data?.is_admin === true;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options();

  let user;
  try { user = await requireAuth(event); } catch (e) { return fail('UNAUTHORIZED', e.message, 401); }

  const admin = await isAdmin(user.id);
  if (!admin) return fail('FORBIDDEN', 'Admin only', 403);

  const supabase = getAdminClient();
  const { id }   = event.queryStringParameters || {};

  // GET — list all
  if (event.httpMethod === 'GET') {
    const { data, error } = await supabase
      .from('data_source_providers')
      .select('*')
      .order('category')
      .order('name');
    if (error) return fail('DB_ERROR', error.message, 500);
    return ok({ providers: data });
  }

  // POST — create
  if (event.httpMethod === 'POST') {
    let body;
    try { body = parseJsonBody(event); } catch { return fail('BAD_REQUEST', 'invalid JSON', 400); }
    const { name, label, category, config, api_key_env, notes } = body;
    if (!name || !label || !category) return fail('BAD_REQUEST', 'name, label, category required', 400);
    const { data, error } = await supabase.from('data_source_providers').insert({
      name, label, category,
      config:      config || {},
      api_key_env: api_key_env || null,
      notes:       notes || null,
      is_active:   false,
      is_builtin:  false,
    }).select().single();
    if (error) return fail('DB_ERROR', error.message, 500);
    return ok({ provider: data });
  }

  // PUT — update
  if (event.httpMethod === 'PUT') {
    if (!id) return fail('BAD_REQUEST', 'id required', 400);
    let body;
    try { body = parseJsonBody(event); } catch { return fail('BAD_REQUEST', 'invalid JSON', 400); }
    const allowed = ['is_active', 'config', 'api_key_env', 'label', 'notes'];
    const patch   = {};
    for (const k of allowed) { if (k in body) patch[k] = body[k]; }
    const { data, error } = await supabase.from('data_source_providers')
      .update(patch).eq('id', id).select().single();
    if (error) return fail('DB_ERROR', error.message, 500);
    return ok({ provider: data });
  }

  // DELETE
  if (event.httpMethod === 'DELETE') {
    if (!id) return fail('BAD_REQUEST', 'id required', 400);
    const { data: existing } = await supabase.from('data_source_providers').select('is_builtin').eq('id', id).single();
    if (existing?.is_builtin) return fail('FORBIDDEN', 'Cannot delete built-in provider', 403);
    await supabase.from('data_source_providers').delete().eq('id', id);
    return ok({ deleted: true });
  }

  return fail('METHOD_NOT_ALLOWED', 'Allowed: GET POST PUT DELETE', 405);
};
