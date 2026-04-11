'use strict';

/**
 * export-leads.js
 *
 * GET /.netlify/functions/export-leads
 *
 * Returns a UTF-8 CSV (with BOM for Hebrew Excel) of the user's leads.
 * Respects the same filter params as get-leads.js.
 *
 * Query params: asset_id, status, search, date_from, date_to
 */

const { fail, options }        = require('./_shared/http');
const { createRequestContext } = require('./_shared/observability');
const { requireAuth }          = require('./_shared/auth');
const { AppError }             = require('./_shared/errors');
const { exportLeadsCSV }       = require('./_shared/leads-service');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options();
  const ctx = createRequestContext(event, 'export-leads');

  try {
    if (event.httpMethod !== 'GET') {
      throw new AppError({ code: 'METHOD_NOT_ALLOWED', userMessage: 'Use GET', status: 405 });
    }

    const user = await requireAuth(event, 'export-leads', ctx);
    const q    = event.queryStringParameters || {};

    const csv = await exportLeadsCSV(user.id, {
      assetId:  q.asset_id  || null,
      status:   q.status    || null,
      search:   q.search    || null,
      dateFrom: q.date_from || null,
      dateTo:   q.date_to   || null,
    });

    const filename = `leads-${new Date().toISOString().slice(0, 10)}.csv`;

    return {
      statusCode: 200,
      headers: {
        'Content-Type':        'text/csv; charset=UTF-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control':       'no-store',
      },
      body: csv,
    };

  } catch (err) {
    return fail(err, ctx.requestId);
  }
};
