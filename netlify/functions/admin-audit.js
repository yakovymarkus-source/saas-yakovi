'use strict';

const { ok, fail, options }                     = require('./_shared/http');
const { createRequestContext, buildLogPayload }  = require('./_shared/observability');
const { writeRequestLog, getAdminClient }        = require('./_shared/supabase');
const { requireAdmin }                           = require('./_shared/admin-auth');
const { AppError }                               = require('./_shared/errors');

const PAGE_LIMIT = 50;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options();
  const context = createRequestContext(event, 'admin-audit');
  try {
    if (event.httpMethod !== 'GET') {
      throw new AppError({ code: 'METHOD_NOT_ALLOWED', status: 405 });
    }
    await requireAdmin(event, context.functionName, context);

    const sb     = getAdminClient();
    const params = event.queryStringParameters || {};
    const page   = Math.max(1, parseInt(params.page  || '1',  10));
    const limit  = Math.min(200, parseInt(params.limit || String(PAGE_LIMIT), 10));
    const offset = (page - 1) * limit;

    let q = sb.from('audit_log')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (params.userId) q = q.eq('user_id', params.userId);
    if (params.action) q = q.eq('action', params.action);
    if (params.since)  q = q.gte('created_at', params.since);

    const { data: entries, count: total, error } = await q;
    if (error) throw new AppError({ code: 'DB_READ_FAILED', devMessage: error.message, status: 500 });

    // Enrich with emails — single query for unique user IDs in page
    const userIds = [...new Set((entries || []).map(e => e.user_id).filter(Boolean))];
    let emailMap  = {};
    if (userIds.length > 0) {
      const { data: profiles } = await sb.from('profiles').select('id, email').in('id', userIds);
      emailMap = Object.fromEntries((profiles || []).map(p => [p.id, p.email]));
    }

    const enriched = (entries || []).map(e => ({
      ...e,
      userEmail: emailMap[e.user_id] || null,
    }));

    await writeRequestLog(buildLogPayload(context, 'info', 'admin_audit_read', { page, limit }));
    return ok({ entries: enriched, total, page, limit }, context.requestId);
  } catch (error) {
    await writeRequestLog(buildLogPayload(context, 'error', 'admin_audit_failed', { code: error.code })).catch(() => {});
    return fail(error, context.requestId);
  }
};
