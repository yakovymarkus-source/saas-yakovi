'use strict';

/**
 * asset-metrics.js
 *
 * GET  ?asset_id=uuid  — load metrics for one asset (summary + history)
 * GET  (no param)      — load latest metric per asset for all user assets
 * POST — save a metric entry for an asset
 *        Body: { asset_id, impressions, clicks, conversions, revenue, source }
 * PATCH — update existing metric row
 *        Body: { id, impressions?, clicks?, conversions?, revenue? }
 */

const { ok, fail, options }    = require('./_shared/http');
const { createRequestContext } = require('./_shared/observability');
const { requireAuth }          = require('./_shared/auth');
const { parseJsonBody }        = require('./_shared/request');
const { getAdminClient }       = require('./_shared/supabase');
const { AppError }             = require('./_shared/errors');
const { advanceOnboarding }    = require('./_shared/product-context');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options();
  const ctx = createRequestContext(event, 'asset-metrics');

  try {
    const user = await requireAuth(event, 'asset-metrics', ctx);
    const sb   = getAdminClient();

    // ── GET ──────────────────────────────────────────────────────────────────
    if (event.httpMethod === 'GET') {
      const q        = event.queryStringParameters || {};
      const assetId  = q.asset_id;

      if (assetId) {
        // Verify ownership
        const { data: asset } = await sb.from('generated_assets')
          .select('id').eq('id', assetId).eq('user_id', user.id).maybeSingle();
        if (!asset) throw new AppError({ code: 'NOT_FOUND', userMessage: 'Asset לא נמצא', status: 404 });

        const { data, error } = await sb.from('asset_metrics')
          .select('*').eq('asset_id', assetId)
          .order('recorded_at', { ascending: false });
        if (error) throw new AppError({ code: 'DB_READ_FAILED', devMessage: error.message, status: 500 });

        // Aggregate totals
        const totals = (data || []).reduce((acc, m) => ({
          impressions: acc.impressions + (m.impressions || 0),
          clicks:      acc.clicks      + (m.clicks      || 0),
          conversions: acc.conversions + (m.conversions || 0),
          revenue:     acc.revenue     + Number(m.revenue || 0),
        }), { impressions: 0, clicks: 0, conversions: 0, revenue: 0 });

        totals.ctr      = totals.impressions > 0 ? +(totals.clicks / totals.impressions * 100).toFixed(2) : null;
        totals.convRate = totals.clicks > 0      ? +(totals.conversions / totals.clicks * 100).toFixed(2) : null;

        return ok({ entries: data || [], totals }, ctx.requestId);
      }

      // All assets — latest entry per asset
      const { data: assets } = await sb.from('generated_assets')
        .select('id, asset_type, title, status, created_at')
        .eq('user_id', user.id)
        .neq('status', 'archived')
        .order('created_at', { ascending: false });

      if (!assets?.length) return ok([], ctx.requestId);

      const { data: metrics } = await sb.from('asset_metrics')
        .select('asset_id, impressions, clicks, conversions, revenue, recorded_at')
        .eq('user_id', user.id)
        .order('recorded_at', { ascending: false });

      // Aggregate per asset
      const metricMap = {};
      for (const m of metrics || []) {
        if (!metricMap[m.asset_id]) metricMap[m.asset_id] = { impressions: 0, clicks: 0, conversions: 0, revenue: 0 };
        metricMap[m.asset_id].impressions += m.impressions || 0;
        metricMap[m.asset_id].clicks      += m.clicks      || 0;
        metricMap[m.asset_id].conversions += m.conversions || 0;
        metricMap[m.asset_id].revenue     += Number(m.revenue || 0);
      }

      const enriched = assets.map(a => {
        const m = metricMap[a.id] || null;
        return {
          ...a,
          metrics: m ? {
            ...m,
            ctr:      m.impressions > 0 ? +(m.clicks / m.impressions * 100).toFixed(2) : null,
            convRate: m.clicks > 0      ? +(m.conversions / m.clicks * 100).toFixed(2)  : null,
          } : null,
        };
      });

      return ok(enriched, ctx.requestId);
    }

    // ── POST — add metric entry ───────────────────────────────────────────────
    if (event.httpMethod === 'POST') {
      const body = parseJsonBody(event, { allowEmpty: false });
      const { asset_id, impressions = 0, clicks = 0, conversions = 0, revenue = 0, source = 'manual' } = body;

      if (!asset_id || !UUID_RE.test(asset_id)) {
        throw new AppError({ code: 'BAD_REQUEST', userMessage: 'asset_id לא תקין', status: 400 });
      }

      // Verify ownership
      const { data: asset } = await sb.from('generated_assets')
        .select('id').eq('id', asset_id).eq('user_id', user.id).maybeSingle();
      if (!asset) throw new AppError({ code: 'NOT_FOUND', userMessage: 'Asset לא נמצא', status: 404 });

      const { data, error } = await sb.from('asset_metrics').insert({
        asset_id,
        user_id:     user.id,
        impressions: Math.max(0, parseInt(impressions) || 0),
        clicks:      Math.max(0, parseInt(clicks)      || 0),
        conversions: Math.max(0, parseInt(conversions) || 0),
        revenue:     Math.max(0, parseFloat(revenue)   || 0),
        source,
      }).select().single();

      if (error) throw new AppError({ code: 'DB_WRITE_FAILED', devMessage: error.message, status: 500 });

      // Advance onboarding — user now has metrics
      advanceOnboarding(user.id, sb, 'has_metrics').catch(() => {});

      return ok(data, ctx.requestId);
    }

    // ── PATCH — update metric entry ───────────────────────────────────────────
    if (event.httpMethod === 'PATCH') {
      const body = parseJsonBody(event, { allowEmpty: false });
      const { id, ...fields } = body;

      if (!id || !UUID_RE.test(id)) {
        throw new AppError({ code: 'BAD_REQUEST', userMessage: 'id לא תקין', status: 400 });
      }

      const patch = {};
      if (fields.impressions !== undefined) patch.impressions = Math.max(0, parseInt(fields.impressions) || 0);
      if (fields.clicks      !== undefined) patch.clicks      = Math.max(0, parseInt(fields.clicks)      || 0);
      if (fields.conversions !== undefined) patch.conversions = Math.max(0, parseInt(fields.conversions) || 0);
      if (fields.revenue     !== undefined) patch.revenue     = Math.max(0, parseFloat(fields.revenue)   || 0);

      if (!Object.keys(patch).length) {
        throw new AppError({ code: 'BAD_REQUEST', userMessage: 'אין שדות לעדכון', status: 400 });
      }

      const { data, error } = await sb.from('asset_metrics')
        .update(patch).eq('id', id).eq('user_id', user.id).select().single();
      if (error) throw new AppError({ code: 'DB_WRITE_FAILED', devMessage: error.message, status: 500 });
      return ok(data, ctx.requestId);
    }

    // ── DELETE ────────────────────────────────────────────────────────────────
    if (event.httpMethod === 'DELETE') {
      const body = parseJsonBody(event, { allowEmpty: false });
      const { id } = body;
      if (!id || !UUID_RE.test(id)) {
        throw new AppError({ code: 'BAD_REQUEST', userMessage: 'id לא תקין', status: 400 });
      }
      const { error } = await sb.from('asset_metrics')
        .delete().eq('id', id).eq('user_id', user.id);
      if (error) throw new AppError({ code: 'DB_WRITE_FAILED', devMessage: error.message, status: 500 });
      return ok({ deleted: true }, ctx.requestId);
    }

    throw new AppError({ code: 'METHOD_NOT_ALLOWED', userMessage: 'Method not allowed', status: 405 });

  } catch (err) {
    return fail(err, ctx.requestId);
  }
};
