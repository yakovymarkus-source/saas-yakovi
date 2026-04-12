'use strict';

/**
 * admin-assets.js
 *
 * Admin-only overview of generated assets + onboarding progress.
 *
 * GET ?view=assets   — all assets with user info, paginated
 *     ?view=onboarding — all users' onboarding_progress
 *     ?view=metrics   — aggregated asset_metrics summary per user
 *     ?user_id=uuid  — filter by user
 *     ?page=1&limit=25
 */

const { ok, fail, options }    = require('./_shared/http');
const { createRequestContext } = require('./_shared/observability');
const { requireAdmin }         = require('./_shared/admin-auth');
const { getAdminClient }       = require('./_shared/supabase');
const { AppError }             = require('./_shared/errors');

const PAGE_LIMIT = 25;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options();
  const ctx = createRequestContext(event, 'admin-assets');

  try {
    await requireAdmin(event, 'admin-assets', ctx);
    const sb  = getAdminClient();
    const q   = event.queryStringParameters || {};
    const view = q.view || 'assets';

    if (event.httpMethod !== 'GET') {
      throw new AppError({ code: 'METHOD_NOT_ALLOWED', userMessage: 'GET only', status: 405 });
    }

    const page   = Math.max(1, parseInt(q.page  || '1', 10));
    const limit  = Math.min(100, parseInt(q.limit || String(PAGE_LIMIT), 10));
    const offset = (page - 1) * limit;

    // ── assets view ───────────────────────────────────────────────────────────
    if (view === 'assets') {
      let query = sb.from('generated_assets')
        .select('id, user_id, asset_type, title, status, preview_url, created_at', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (q.user_id) query = query.eq('user_id', q.user_id);
      if (q.status)  query = query.eq('status', q.status);

      const { data: assets, count, error } = await query;
      if (error) throw new AppError({ code: 'DB_READ_FAILED', devMessage: error.message, status: 500 });

      // Enrich with profile info
      const userIds = [...new Set((assets || []).map(a => a.user_id))];
      const { data: profiles } = userIds.length
        ? await sb.from('profiles').select('id, email, name').in('id', userIds)
        : { data: [] };
      const profileMap = Object.fromEntries((profiles || []).map(p => [p.id, p]));

      const enriched = (assets || []).map(a => ({
        ...a,
        userEmail: profileMap[a.user_id]?.email || null,
        userName:  profileMap[a.user_id]?.name  || null,
      }));

      return ok({ assets: enriched, total: count || 0, page, limit }, ctx.requestId);
    }

    // ── onboarding view ───────────────────────────────────────────────────────
    if (view === 'onboarding') {
      const { data, error } = await sb
        .from('onboarding_progress')
        .select('user_id, steps, current_step, completed, updated_at')
        .order('updated_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) throw new AppError({ code: 'DB_READ_FAILED', devMessage: error.message, status: 500 });

      const userIds = [...new Set((data || []).map(r => r.user_id))];
      const { data: profiles } = userIds.length
        ? await sb.from('profiles').select('id, email, name').in('id', userIds)
        : { data: [] };
      const profileMap = Object.fromEntries((profiles || []).map(p => [p.id, p]));

      const enriched = (data || []).map(r => ({
        ...r,
        userEmail: profileMap[r.user_id]?.email || null,
        userName:  profileMap[r.user_id]?.name  || null,
      }));

      return ok(enriched, ctx.requestId);
    }

    // ── metrics summary view ──────────────────────────────────────────────────
    if (view === 'metrics') {
      const { data: metrics, error } = await sb
        .from('asset_metrics')
        .select('user_id, asset_id, clicks, conversions, revenue, recorded_at');

      if (error) throw new AppError({ code: 'DB_READ_FAILED', devMessage: error.message, status: 500 });

      // Aggregate per user
      const userMap = {};
      for (const m of metrics || []) {
        if (!userMap[m.user_id]) userMap[m.user_id] = { user_id: m.user_id, clicks: 0, conversions: 0, revenue: 0, entries: 0 };
        userMap[m.user_id].clicks      += m.clicks      || 0;
        userMap[m.user_id].conversions += m.conversions || 0;
        userMap[m.user_id].revenue     += Number(m.revenue || 0);
        userMap[m.user_id].entries     += 1;
      }

      const userIds = Object.keys(userMap);
      const { data: profiles } = userIds.length
        ? await sb.from('profiles').select('id, email, name').in('id', userIds)
        : { data: [] };
      const profileMap = Object.fromEntries((profiles || []).map(p => [p.id, p]));

      const summary = Object.values(userMap).map(u => ({
        ...u,
        userEmail: profileMap[u.user_id]?.email || null,
        userName:  profileMap[u.user_id]?.name  || null,
      })).sort((a, b) => b.revenue - a.revenue);

      return ok(summary, ctx.requestId);
    }

    throw new AppError({ code: 'BAD_REQUEST', userMessage: 'Invalid view param', status: 400 });

  } catch (err) {
    return fail(err, ctx.requestId);
  }
};
