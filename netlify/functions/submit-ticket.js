'use strict';

/**
 * submit-ticket.js
 *
 * POST /.netlify/functions/submit-ticket
 *
 * Authenticated users submit a support ticket.
 * The ticket is associated with the requesting user — user_id is never trusted
 * from the request body; it is always taken from the verified JWT.
 *
 * Body: { type, title, description }
 */

const { ok, fail, options }        = require('./_shared/http');
const { createRequestContext }     = require('./_shared/observability');
const { requireAuth }              = require('./_shared/auth');
const { parseJsonBody }            = require('./_shared/request');
const { getAdminClient }           = require('./_shared/supabase');
const { AppError }                 = require('./_shared/errors');
const { sendEmail }                = require('./_shared/email');

const VALID_TYPES = new Set(['question', 'bug', 'feature_request', 'feedback']);

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options();
  const ctx = createRequestContext(event, 'submit-ticket');

  try {
    if (event.httpMethod !== 'POST') {
      throw new AppError({ code: 'METHOD_NOT_ALLOWED', userMessage: 'Use POST', status: 405 });
    }

    const user = await requireAuth(event, 'submit-ticket', ctx);
    const body = parseJsonBody(event, { allowEmpty: false });

    const { type, title, description } = body;

    if (!type || !VALID_TYPES.has(type)) {
      throw new AppError({
        code:        'BAD_REQUEST',
        userMessage: `סוג פנייה לא תקין. ערכים מותרים: ${[...VALID_TYPES].join(', ')}`,
        status:      400,
      });
    }

    const safeTitle = String(title || '').trim();
    const safeDesc  = String(description || '').trim();

    if (safeTitle.length < 3 || safeTitle.length > 200) {
      throw new AppError({
        code: 'BAD_REQUEST', userMessage: 'כותרת חייבת להיות בין 3 ל-200 תווים', status: 400,
      });
    }
    if (safeDesc.length < 10 || safeDesc.length > 2000) {
      throw new AppError({
        code: 'BAD_REQUEST', userMessage: 'תיאור חייב להיות בין 10 ל-2000 תווים', status: 400,
      });
    }

    const { data, error } = await getAdminClient()
      .from('support_tickets')
      .insert({
        user_id:     user.id,
        type,
        title:       safeTitle,
        description: safeDesc,
        status:      'open',
      })
      .select('id')
      .single();

    if (error) {
      throw new AppError({ code: 'DB_WRITE_FAILED', devMessage: error.message, status: 500 });
    }

    // Notify admin — fire-and-forget so ticket creation never fails due to email
    const adminEmail = process.env.ADMIN_EMAIL;
    if (adminEmail) {
      const typeLabels = { question: 'שאלה', bug: 'באג', feature_request: 'בקשת פיצ׳ר', feedback: 'משוב' };
      sendEmail({
        to:      adminEmail,
        subject: `📩 פנייה חדשה — ${typeLabels[type] || type}: ${safeTitle}`,
        html: `<div dir="rtl" style="font-family:Arial,sans-serif;font-size:15px;line-height:1.7;color:#1a1a1a;max-width:540px;margin:0 auto;padding:32px 24px;">
<h2 style="margin:0 0 20px;font-size:22px;">📩 פנייה חדשה מהמערכת</h2>
<p><strong>סוג:</strong> ${typeLabels[type] || type}</p>
<p><strong>כותרת:</strong> ${safeTitle}</p>
<p><strong>משתמש:</strong> ${user.id}</p>
<div style="background:#f8fafc;border-right:4px solid #6366f1;padding:16px 20px;border-radius:0 8px 8px 0;margin:16px 0;white-space:pre-wrap;">${safeDesc}</div>
<p><a href="${process.env.APP_URL || ''}" style="display:inline-block;background:#111;color:#fff;padding:12px 24px;text-decoration:none;border-radius:7px;font-weight:bold;">פתח לוח ניהול</a></p>
<hr style="border:none;border-top:1px solid #e5e5e5;margin:24px 0 12px;">
<p style="font-size:12px;color:#999;">CampaignBrain — מערכת ניהול קמפיינים</p>
</div>`,
      }).catch(e => console.warn('[submit-ticket] admin email failed:', e.message));
    }

    return ok({ ticketId: data.id }, ctx.requestId);

  } catch (err) {
    return fail(err, ctx.requestId);
  }
};
