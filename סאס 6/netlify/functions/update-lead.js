'use strict';

/**
 * update-lead.js
 *
 * PATCH /.netlify/functions/update-lead
 *
 * Body: { lead_id, status }
 * Allowed statuses: new | contacted | qualified | closed | archived
 */

const { ok, fail, options }    = require('./_shared/http');
const { createRequestContext } = require('./_shared/observability');
const { requireAuth }          = require('./_shared/auth');
const { parseJsonBody }        = require('./_shared/request');
const { AppError }             = require('./_shared/errors');
const { updateLeadStatus }     = require('./_shared/leads-service');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options();
  const ctx = createRequestContext(event, 'update-lead');

  try {
    if (event.httpMethod !== 'PATCH' && event.httpMethod !== 'POST') {
      throw new AppError({ code: 'METHOD_NOT_ALLOWED', userMessage: 'Use PATCH', status: 405 });
    }

    const user = await requireAuth(event, 'update-lead', ctx);
    const body = parseJsonBody(event, { allowEmpty: false, devMessage: 'Missing body' });

    const { lead_id, status } = body;
    if (!lead_id) throw new AppError({ code: 'BAD_REQUEST', userMessage: 'חסר lead_id', status: 400 });
    if (!status)  throw new AppError({ code: 'BAD_REQUEST', userMessage: 'חסר status', status: 400 });

    const result = await updateLeadStatus(lead_id, user.id, status);
    return ok(result, ctx.requestId);

  } catch (err) {
    return fail(err, ctx.requestId);
  }
};
