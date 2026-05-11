'use strict';
require('./_shared/env');

const { ok, fail, options } = require('./_shared/http');
const { requireAuth } = require('./_shared/auth');
const { parseJsonBody } = require('./_shared/request');
const { getAdminClient } = require('./_shared/supabase');

/**
 * POST /save-asset
 * Save a generated asset (image, landing page, etc.) to the assets table
 * Body: { name, type, category, url }
 */
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options();
  if (event.httpMethod !== 'POST') return fail('METHOD_NOT_ALLOWED', 'POST only', 405);

  let user;
  try { user = await requireAuth(event); } catch (e) { return fail('UNAUTHORIZED', e.message, 401); }

  let body;
  try { body = parseJsonBody(event); } catch { return fail('BAD_REQUEST', 'invalid JSON', 400); }

  const { name, type, category, url } = body;
  if (!name || !type || !category || !url) {
    return fail('BAD_REQUEST', 'name, type, category, url are required', 400);
  }

  try {
    const sb = getAdminClient();
    const { error } = await sb.from('assets').insert({
      user_id: user.id,
      name,
      type,
      category,
      url,
      size_bytes: null,
    });

    if (error) throw error;

    return ok({ message: 'Asset saved successfully', name });
  } catch (err) {
    console.error('[save-asset]', err.message);
    return fail('DATABASE_ERROR', 'Failed to save asset', 500);
  }
};
