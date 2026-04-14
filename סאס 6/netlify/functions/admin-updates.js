'use strict';

/**
 * admin-updates.js
 *
 * Admin-only CRUD for product updates.
 *
 * GET    — list all updates (published + drafts)
 * POST   — create a new update
 * PATCH  — edit existing update (title, content, type, is_published, is_pinned)
 * DELETE — permanently delete an update
 *
 * All methods require admin access (is_admin = true in profiles).
 */

const { ok, fail, options }        = require('./_shared/http');
const { createRequestContext }     = require('./_shared/observability');
const { requireAdmin }             = require('./_shared/admin-auth');
const { parseJsonBody }            = require('./_shared/request');
const { getAdminClient }           = require('./_shared/supabase');
const { AppError }                 = require('./_shared/errors');

const VALID_TYPES  = new Set(['new', 'improved', 'fixed']);
const UUID_RE      = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options();
  const ctx = createRequestContext(event, 'admin-updates');

  try {
    await requireAdmin(event, 'admin-updates', ctx);
    const sb = getAdminClient();

    // ── GET — list all updates ───────────────────────────────────────────────
    if (event.httpMethod === 'GET') {
      const { data, error } = await sb
        .from('updates')
        .select('*')
        .order('is_pinned', { ascending: false })
        .order('created_at', { ascending: false });

      if (error) throw new AppError({ code: 'DB_READ_FAILED', devMessage: error.message, status: 500 });
      return ok(data || [], ctx.requestId);
    }

    // ── POST — create update ─────────────────────────────────────────────────
    if (event.httpMethod === 'POST') {
      const body = parseJsonBody(event, { allowEmpty: false });
      const { title, content, type, is_published = false, is_pinned = false } = body;

      if (!title?.trim()) {
        throw new AppError({ code: 'BAD_REQUEST', userMessage: 'Title is required', status: 400 });
      }
      if (!content?.trim()) {
        throw new AppError({ code: 'BAD_REQUEST', userMessage: 'Content is required', status: 400 });
      }
      if (!VALID_TYPES.has(type)) {
        throw new AppError({ code: 'BAD_REQUEST', userMessage: `Invalid type. Allowed: ${[...VALID_TYPES].join(', ')}`, status: 400 });
      }

      const { data, error } = await sb
        .from('updates')
        .insert({
          title:        String(title).trim().slice(0, 200),
          content:      String(content).trim().slice(0, 5000),
          type,
          is_published: Boolean(is_published),
          is_pinned:    Boolean(is_pinned),
        })
        .select()
        .single();

      if (error) throw new AppError({ code: 'DB_WRITE_FAILED', devMessage: error.message, status: 500 });
      return ok(data, ctx.requestId);
    }

    // ── PATCH — edit update ──────────────────────────────────────────────────
    if (event.httpMethod === 'PATCH') {
      const body = parseJsonBody(event, { allowEmpty: false });
      const { id, ...fields } = body;

      if (!id || !UUID_RE.test(id)) {
        throw new AppError({ code: 'BAD_REQUEST', userMessage: 'Invalid or missing id', status: 400 });
      }

      const allowed = {};
      if (fields.title       !== undefined) allowed.title        = String(fields.title).trim().slice(0, 200);
      if (fields.content     !== undefined) allowed.content      = String(fields.content).trim().slice(0, 5000);
      if (fields.type        !== undefined && VALID_TYPES.has(fields.type)) allowed.type = fields.type;
      if (fields.is_published !== undefined) allowed.is_published = Boolean(fields.is_published);
      if (fields.is_pinned   !== undefined) allowed.is_pinned    = Boolean(fields.is_pinned);

      if (!Object.keys(allowed).length) {
        throw new AppError({ code: 'BAD_REQUEST', userMessage: 'No valid fields to update', status: 400 });
      }
      allowed.updated_at = new Date().toISOString();

      const { data, error } = await sb
        .from('updates')
        .update(allowed)
        .eq('id', id)
        .select()
        .single();

      if (error) throw new AppError({ code: 'DB_WRITE_FAILED', devMessage: error.message, status: 500 });
      return ok(data, ctx.requestId);
    }

    // ── DELETE — remove update ───────────────────────────────────────────────
    if (event.httpMethod === 'DELETE') {
      const body = parseJsonBody(event, { allowEmpty: false });
      const { id } = body;

      if (!id || !UUID_RE.test(id)) {
        throw new AppError({ code: 'BAD_REQUEST', userMessage: 'Invalid or missing id', status: 400 });
      }

      const { error } = await sb.from('updates').delete().eq('id', id);
      if (error) throw new AppError({ code: 'DB_WRITE_FAILED', devMessage: error.message, status: 500 });
      return ok({ deleted: true }, ctx.requestId);
    }

    throw new AppError({ code: 'METHOD_NOT_ALLOWED', userMessage: 'Method not allowed', status: 405 });

  } catch (err) {
    return fail(err, ctx.requestId);
  }
};
