'use strict';

/**
 * delete-lead.js
 *
 * DELETE /.netlify/functions/delete-lead
 *
 * Body: { lead_id }
 */

const { ok, fail, options }    = require('./_shared/http');
const { createRequestContext } = require('./_shared/observability');
const { requireAuth }          = require('./_shared/auth');
const { parseJsonBody }        = require('./_shared/request');
const { AppError }             = require('./_shared/errors');
const { deleteLead }           = require('./_shared/leads-service');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options();
  const ctx = createRequestContext(event, 'delete-lead');

  try {
    if (event.httpMethod !== 'DELETE' && event.httpMethod !== 'POST') {
      throw new AppError({ code: 'METHOD_NOT_ALLOWED', userMessage: 'Use DELETE', status: 405 });
    }

    const user = await requireAuth(event, 'delete-lead', ctx);
    const body = parseJsonBody(event, { allowEmpty: false, devMessage: 'Missing body' });

    const { lead_id } = body;
    if (!lead_id) throw new AppError({ code: 'BAD_REQUEST', userMessage: 'חסר lead_id', status: 400 });

    await deleteLead(lead_id, user.id);
    return ok({ deleted: true, lead_id }, ctx.requestId);

  } catch (err) {
    return fail(err, ctx.requestId);
  }
};
