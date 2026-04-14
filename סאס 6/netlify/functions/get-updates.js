'use strict';

/**
 * get-updates.js
 *
 * GET /.netlify/functions/get-updates
 *
 * Returns all published product updates, newest first (pinned first within that).
 * No authentication required — updates are public product announcements.
 */

const { ok, fail, options }        = require('./_shared/http');
const { createRequestContext }     = require('./_shared/observability');
const { getAdminClient }           = require('./_shared/supabase');
const { AppError }                 = require('./_shared/errors');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options();
  const ctx = createRequestContext(event, 'get-updates');

  try {
    if (event.httpMethod !== 'GET') {
      throw new AppError({ code: 'METHOD_NOT_ALLOWED', userMessage: 'Use GET', status: 405 });
    }

    const { data, error } = await getAdminClient()
      .from('updates')
      .select('id, title, content, type, is_pinned, created_at')
      .eq('is_published', true)
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) {
      throw new AppError({ code: 'DB_READ_FAILED', devMessage: error.message, status: 500 });
    }

    return ok(data || [], ctx.requestId);

  } catch (err) {
    return fail(err, ctx.requestId);
  }
};
