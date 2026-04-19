'use strict';

/**
 * admin-support.js
 *
 * Admin-only management of support tickets.
 *
 * GET   — list all tickets with user info + pagination + optional status filter
 *         ?page=1&limit=25&status=open|in_progress|closed
 * PATCH — update ticket status
 *         Body: { id, status }
 *
 * All methods require admin access (is_admin = true in profiles).
 */

const { ok, fail, options }        = require('./_shared/http');
const { createRequestContext }     = require('./_shared/observability');
const { requireAdmin }             = require('./_shared/admin-auth');
const { parseJsonBody }            = require('./_shared/request');
const { getAdminClient }           = require('./_shared/supabase');
const { AppError }                 = require('./_shared/errors');
const { sendEmail }                = require('./_shared/email');

const VALID_STATUSES = new Set(['open', 'in_progress', 'closed']);
const UUID_RE        = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE_LIMIT     = 25;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options();
  const ctx = createRequestContext(event, 'admin-support');

  try {
    await requireAdmin(event, 'admin-support', ctx);
    const sb = getAdminClient();

    // ── GET — list tickets ───────────────────────────────────────────────────
    if (event.httpMethod === 'GET') {
      const q      = event.queryStringParameters || {};
      const page   = Math.max(1, parseInt(q.page  || '1',  10));
      const limit  = Math.min(50, parseInt(q.limit || String(PAGE_LIMIT), 10));
      const offset = (page - 1) * limit;

      // 1. Fetch paginated tickets
      let ticketsQ = sb
        .from('support_tickets')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (q.status && VALID_STATUSES.has(q.status)) {
        ticketsQ = ticketsQ.eq('status', q.status);
      }

      const { data: tickets, count, error: tErr } = await ticketsQ;
      if (tErr) throw new AppError({ code: 'DB_READ_FAILED', devMessage: tErr.message, status: 500 });

      if (!tickets || tickets.length === 0) {
        return ok({ tickets: [], total: count || 0, page, limit }, ctx.requestId);
      }

      // 2. Enrich with profile + plan info (two lookups, never trust client)
      const userIds = [...new Set(tickets.map(t => t.user_id))];

      const [profilesRes, subsRes] = await Promise.all([
        sb.from('profiles').select('id, email, name').in('id', userIds),
        sb.from('subscriptions').select('user_id, plan').in('user_id', userIds),
      ]);

      const profileMap = Object.fromEntries((profilesRes.data || []).map(p => [p.id, p]));
      const planMap    = Object.fromEntries((subsRes.data    || []).map(s => [s.user_id, s.plan]));

      const enriched = tickets.map(t => ({
        ...t,
        userEmail: profileMap[t.user_id]?.email || null,
        userName:  profileMap[t.user_id]?.name  || null,
        userPlan:  planMap[t.user_id]            || 'free',
      }));

      return ok({ tickets: enriched, total: count || 0, page, limit }, ctx.requestId);
    }

    // ── PATCH — update status ────────────────────────────────────────────────
    if (event.httpMethod === 'PATCH') {
      const body = parseJsonBody(event, { allowEmpty: false });
      const { id, status } = body;

      if (!id || !UUID_RE.test(id)) {
        throw new AppError({ code: 'BAD_REQUEST', userMessage: 'Invalid or missing id', status: 400 });
      }
      if (!status || !VALID_STATUSES.has(status)) {
        throw new AppError({
          code: 'BAD_REQUEST',
          userMessage: `Invalid status. Allowed: ${[...VALID_STATUSES].join(', ')}`,
          status: 400,
        });
      }

      const { data, error } = await sb
        .from('support_tickets')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();

      if (error) throw new AppError({ code: 'DB_WRITE_FAILED', devMessage: error.message, status: 500 });
      return ok(data, ctx.requestId);
    }

    // ── POST — reply to ticket ───────────────────────────────────────────────
    if (event.httpMethod === 'POST') {
      const body = parseJsonBody(event, { allowEmpty: false });
      const { ticketId, message: replyMsg } = body;

      if (!ticketId || !UUID_RE.test(ticketId)) {
        throw new AppError({ code: 'BAD_REQUEST', userMessage: 'ticketId חסר או לא תקין', status: 400 });
      }
      if (!replyMsg || String(replyMsg).trim().length < 2) {
        throw new AppError({ code: 'BAD_REQUEST', userMessage: 'הודעת תגובה ריקה', status: 400 });
      }

      // Get ticket
      const { data: ticket, error: tErr } = await sb
        .from('support_tickets').select('*').eq('id', ticketId).single();
      if (tErr || !ticket) throw new AppError({ code: 'NOT_FOUND', userMessage: 'פנייה לא נמצאה', status: 404 });

      // Get user email for the reply
      let toEmail = null;
      if (ticket.user_id) {
        const { data: prof } = await sb.from('profiles').select('email, name').eq('id', ticket.user_id).single();
        toEmail = prof?.email || null;
      }

      if (!toEmail) {
        throw new AppError({ code: 'BAD_REQUEST', userMessage: 'לא ניתן למצוא אימייל של המשתמש', status: 400 });
      }

      const APP_URL = process.env.APP_URL || process.env.URL || '';
      await sendEmail({
        to:      toEmail,
        subject: `תגובה לפנייתך: ${ticket.title || 'פנייה'}`,
        html: `<div dir="rtl" style="font-family:Arial,sans-serif;font-size:15px;line-height:1.7;color:#1a1a1a;max-width:540px;margin:0 auto;padding:32px 24px;">
<h2 style="margin:0 0 20px;font-size:20px;">קיבלת תגובה לפנייתך ✉️</h2>
<p><strong>פנייה מקורית:</strong> ${ticket.title || '—'}</p>
<hr style="border:none;border-top:1px solid #e5e5e5;margin:16px 0;">
<p style="white-space:pre-wrap;background:#f8fafc;border-right:4px solid #6366f1;padding:12px 16px;border-radius:4px">${String(replyMsg).trim()}</p>
<hr style="border:none;border-top:1px solid #e5e5e5;margin:16px 0;">
<p style="font-size:13px;color:#64748b;">לכניסה למערכת: <a href="${APP_URL}">${APP_URL}</a></p>
<p style="font-size:12px;color:#999;">— צוות CampaignAI</p>
</div>`,
      });

      // Update status to in_progress + save reply text
      await sb.from('support_tickets')
        .update({ status: 'in_progress', updated_at: new Date().toISOString() })
        .eq('id', ticketId);

      return ok({ ticketId, replied: true, to: toEmail }, ctx.requestId);
    }

    throw new AppError({ code: 'METHOD_NOT_ALLOWED', userMessage: 'Method not allowed', status: 405 });

  } catch (err) {
    return fail(err, ctx.requestId);
  }
};
