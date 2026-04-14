'use strict';

/**
 * submit-ticket.js
 *
 * POST /.netlify/functions/submit-ticket
 *
 * Authenticated users submit a support ticket.
 * The ticket is associated with the requesting user — user_id is never trusted
 * from the request body; it is always taken from the verified JWT.
 *
 * Body: { type, title, description }
 */

const { ok, fail, options }        = require('./_shared/http');
const { createRequestContext }     = require('./_shared/observability');
const { requireAuth }              = require('./_shared/auth');
const { parseJsonBody }            = require('./_shared/request');
const { getAdminClient }           = require('./_shared/supabase');
const { AppError }                 = require('./_shared/errors');

const VALID_TYPES = new Set(['question', 'bug', 'feature_request', 'feedback']);

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options();
  const ctx = createRequestContext(event, 'submit-ticket');

  try {
    if (event.httpMethod !== 'POST') {
      throw new AppError({ code: 'METHOD_NOT_ALLOWED', userMessage: 'Use POST', status: 405 });
    }

    const user = await requireAuth(event, 'submit-ticket', ctx);
    const body = parseJsonBody(event, { allowEmpty: false });

    const { type, title, description } = body;

    if (!type || !VALID_TYPES.has(type)) {
      throw new AppError({
        code:        'BAD_REQUEST',
        userMessage: `סוג פנייה לא תקין. ערכים מותרים: ${[...VALID_TYPES].join(', ')}`,
        status:      400,
      });
    }

    const safeTitle = String(title || '').trim();
    const safeDesc  = String(description || '').trim();

    if (safeTitle.length < 3 || safeTitle.length > 200) {
      throw new AppError({
        code: 'BAD_REQUEST', userMessage: 'כותרת חייבת להיות בין 3 ל-200 תווים', status: 400,
      });
    }
    if (safeDesc.length < 10 || safeDesc.length > 2000) {
      throw new AppError({
        code: 'BAD_REQUEST', userMessage: 'תיאור חייב להיות בין 10 ל-2000 תווים', status: 400,
      });
    }

    const { data, error } = await getAdminClient()
      .from('support_tickets')
      .insert({
        user_id:     user.id,
        type,
        title:       safeTitle,
        description: safeDesc,
        status:      'open',
      })
      .select('id')
      .single();

    if (error) {
      throw new AppError({ code: 'DB_WRITE_FAILED', devMessage: error.message, status: 500 });
    }

    return ok({ ticketId: data.id }, ctx.requestId);

  } catch (err) {
    return fail(err, ctx.requestId);
  }
};
