'use strict';
const { requireAuth, requireAdmin } = require('./_shared/auth');
const { getAdminClient, getAnonClient } = require('./_shared/supabase');
const { respond } = require('./_shared/http');

exports.handler = async (event) => {
  const method = event.httpMethod;
  if (method === 'OPTIONS') return { statusCode: 200, body: '' };

  // ── GET — public list (no auth needed) ──────────────────────────────────────
  if (method === 'GET') {
    try {
      const sb = getAdminClient();
      const qs = event.queryStringParameters || {};
      const id = qs.id;

      if (id) {
        const { data, error } = await sb.from('tutorials').select('*').eq('id', id).single();
        if (error) throw error;
        return respond(200, { data });
      }

      let q = sb.from('tutorials').select('*').eq('published', true).order('order_index').order('created_at');
      if (qs.category && qs.category !== 'all') q = q.eq('category', qs.category);

      const { data, error } = await q;
      if (error) throw error;
      return respond(200, { data });
    } catch (err) {
      return respond(500, { error: err.message });
    }
  }

  // ── Admin writes — require admin ─────────────────────────────────────────────
  const authRes = await requireAuth(event);
  if (authRes.error) return respond(401, { error: authRes.error });
  const adminRes = await requireAdmin(authRes.user.id);
  if (adminRes.error) return respond(403, { error: 'Admin only' });

  const sb = getAdminClient();
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch {}

  // ── POST — create ────────────────────────────────────────────────────────────
  if (method === 'POST') {
    const { title, description, youtube_url, thumbnail_url, category, order_index, published } = body;
    if (!title) return respond(400, { error: 'title required' });

    const { data, error } = await sb.from('tutorials').insert({
      title, description, youtube_url, thumbnail_url,
      category: category || 'general',
      order_index: order_index ?? 0,
      published: published !== false,
    }).select().single();

    if (error) return respond(500, { error: error.message });
    return respond(201, { data });
  }

  // ── PUT — update ─────────────────────────────────────────────────────────────
  if (method === 'PUT') {
    const { id, ...fields } = body;
    if (!id) return respond(400, { error: 'id required' });

    const allowed = ['title','description','youtube_url','thumbnail_url','category','order_index','published'];
    const update  = Object.fromEntries(Object.entries(fields).filter(([k]) => allowed.includes(k)));
    update.updated_at = new Date().toISOString();

    const { data, error } = await sb.from('tutorials').update(update).eq('id', id).select().single();
    if (error) return respond(500, { error: error.message });
    return respond(200, { data });
  }

  // ── DELETE ───────────────────────────────────────────────────────────────────
  if (method === 'DELETE') {
    const id = body.id || (event.queryStringParameters || {}).id;
    if (!id) return respond(400, { error: 'id required' });

    const { error } = await sb.from('tutorials').delete().eq('id', id);
    if (error) return respond(500, { error: error.message });
    return respond(200, { ok: true });
  }

  return respond(405, { error: 'Method not allowed' });
};
