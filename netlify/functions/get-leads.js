'use strict';

/**
 * get-leads.js
 *
 * GET /.netlify/functions/get-leads
 *
 * Query params:
 *   asset_id   — filter by asset
 *   status     — filter by status
 *   search     — partial match on name/phone/email
 *   date_from  — ISO date (YYYY-MM-DD)
 *   date_to    — ISO date (YYYY-MM-DD)
 *   sort       — 'newest' (default) | 'oldest'
 *   limit      — default 50, max 200
 *   offset     — default 0
 *   summary    — if '1', return summary counts only
 *   assets     — if '1', return list of assets that have leads (for filter dropdown)
 */

'use strict';

const { ok, fail, options }    = require('./_shared/http');
const { createRequestContext } = require('./_shared/observability');
const { requireAuth }          = require('./_shared/auth');
const {
  getLeadsByUser,
  getLeadSummary,
  getAssetsWithLeads,
} = require('./_shared/leads-service');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options();
  const ctx = createRequestContext(event, 'get-leads');

  try {
    if (event.httpMethod !== 'GET') {
      const { AppError } = require('./_shared/errors');
      throw new AppError({ code: 'METHOD_NOT_ALLOWED', userMessage: 'Use GET', status: 405 });
    }

    const user = await requireAuth(event, 'get-leads', ctx);
    const q    = event.queryStringParameters || {};

    // Summary mode — return counts per status
    if (q.summary === '1') {
      const summary = await getLeadSummary(user.id);
      return ok(summary, ctx.requestId);
    }

    // Assets mode — return list of assets for filter dropdown
    if (q.assets === '1') {
      const assets = await getAssetsWithLeads(user.id);
      return ok(assets, ctx.requestId);
    }

    // Full list with filters
    const result = await getLeadsByUser(user.id, {
      assetId:  q.asset_id  || null,
      status:   q.status    || null,
      search:   q.search    || null,
      dateFrom: q.date_from || null,
      dateTo:   q.date_to   || null,
      sort:     q.sort      || 'newest',
      limit:    q.limit     ? Number(q.limit)  : 50,
      offset:   q.offset    ? Number(q.offset) : 0,
    });

    return ok(result, ctx.requestId);

  } catch (err) {
    return fail(err, ctx.requestId);
  }
};
