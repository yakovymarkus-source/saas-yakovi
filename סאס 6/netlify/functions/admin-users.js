'use strict';

const { ok, fail }                              = require('./_shared/http');
const { createRequestContext, buildLogPayload }  = require('./_shared/observability');
const { writeRequestLog, getAdminClient }        = require('./_shared/supabase');
const { requireAdmin }                           = require('./_shared/admin-auth');
const { AppError }                               = require('./_shared/errors');

const PAGE_LIMIT = 25;

exports.handler = async (event) => {
  const context = createRequestContext(event, 'admin-users');
  try {
    if (event.httpMethod !== 'GET') {
      throw new AppError({ code: 'METHOD_NOT_ALLOWED', userMessage: 'Method not allowed', status: 405 });
    }
    await requireAdmin(event, context.functionName, context);

    const sb     = getAdminClient();
    const params = event.queryStringParameters || {};
    const page   = Math.max(1, parseInt(params.page  || '1', 10));
    const limit  = Math.min(100, parseInt(params.limit || String(PAGE_LIMIT), 10));
    const offset = (page - 1) * limit;

    // Build profiles query with optional filters
    let profilesQ = sb.from('profiles')
      .select('id, email, name, created_at, deleted_at, is_admin', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (params.search) {
      profilesQ = profilesQ.ilike('email', `%${params.search}%`);
    }
    if (params.deleted === 'true') {
      profilesQ = profilesQ.not('deleted_at', 'is', null);
    } else {
      profilesQ = profilesQ.is('deleted_at', null);
    }

    const { data: profiles, count: total, error: pErr } = await profilesQ;
    if (pErr) throw new AppError({ code: 'DB_READ_FAILED', devMessage: pErr.message, status: 500 });

    if (!profiles || profiles.length === 0) {
      return ok({ users: [], total: total || 0, page, limit }, context.requestId);
    }

    const userIds = profiles.map(p => p.id);

    // Fetch subscriptions + campaign counts + last active — all in parallel
    const [subsRes, campsRes, lastActiveRes] = await Promise.all([
      sb.from('subscriptions')
        .select('user_id, plan, status, current_period_end')
        .in('user_id', userIds),

      sb.from('campaigns')
        .select('owner_user_id')
        .in('owner_user_id', userIds),

      sb.rpc('admin_last_active', { p_user_ids: userIds }).catch(() => ({ data: [] })),
    ]);

    // Build lookup maps
    const subMap      = Object.fromEntries((subsRes.data || []).map(s => [s.user_id, s]));
    const campCount   = (campsRes.data || []).reduce((m, c) => { m[c.owner_user_id] = (m[c.owner_user_id] || 0) + 1; return m; }, {});
    const lastActive  = Object.fromEntries((lastActiveRes.data || []).map(r => [r.user_id, r.last_active_at]));

    // Filter by plan/status if requested (post-join)
    let users = profiles.map(p => ({
      id:              p.id,
      email:           p.email,
      name:            p.name,
      isAdmin:         p.is_admin,
      plan:            subMap[p.id]?.plan   || 'free',
      status:          subMap[p.id]?.status || 'active',
      currentPeriodEnd:subMap[p.id]?.current_period_end || null,
      campaignCount:   campCount[p.id]      || 0,
      lastActiveAt:    lastActive[p.id]     || null,
      createdAt:       p.created_at,
      deletedAt:       p.deleted_at,
    }));

    if (params.plan)   users = users.filter(u => u.plan   === params.plan);
    if (params.status) users = users.filter(u => u.status === params.status);

    await writeRequestLog(buildLogPayload(context, 'info', 'admin_users_read', { page, limit }));
    return ok({ users, total, page, limit }, context.requestId);
  } catch (error) {
    await writeRequestLog(buildLogPayload(context, 'error', 'admin_users_failed', { code: error.code })).catch(() => {});
    return fail(error, context.requestId);
  }
};
