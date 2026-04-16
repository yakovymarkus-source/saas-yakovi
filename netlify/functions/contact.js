'use strict';

/**
 * contact.js — Public contact / support form
 *
 * POST { name, email, subject, message }
 * Sends a notification to the admin and a confirmation to the user.
 * Rate-limited by IP via request logs.
 */

const { ok, fail, options }                     = require('./_shared/http');
const { createRequestContext, buildLogPayload } = require('./_shared/observability');
const { writeRequestLog }                       = require('./_shared/supabase');
const { AppError }                              = require('./_shared/errors');
const { parseJsonBody }                         = require('./_shared/request');
const { getEnv }                                = require('./_shared/env');
const { sendEmail }                             = require('./_shared/email');

const APP_URL = () => process.env.APP_URL || process.env.URL || '';

function validateContact(body) {
  const name    = String(body.name    || '').trim().slice(0, 120);
  const email   = String(body.email   || '').trim().slice(0, 200);
  const subject = String(body.subject || '').trim().slice(0, 200) || 'פנייה מהאתר';
  const message = String(body.message || '').trim().slice(0, 2000);

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AppError({ code: 'BAD_REQUEST', userMessage: 'כתובת אימייל לא תקינה', status: 400 });
  }
  if (!message || message.length < 5) {
    throw new AppError({ code: 'BAD_REQUEST', userMessage: 'נא למלא הודעה', status: 400 });
  }
  return { name, email, subject, message };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options();
  const context = createRequestContext(event, 'contact');

  try {
    if (event.httpMethod !== 'POST') {
      throw new AppError({ code: 'METHOD_NOT_ALLOWED', userMessage: 'Method not allowed', status: 405 });
    }

    const body = parseJsonBody(event, { fallback: {}, allowEmpty: false });
    const { name, email, subject, message } = validateContact(body);

    const env        = getEnv();
    const adminEmail = env.ADMIN_EMAIL;

    if (!adminEmail) {
      console.error('[contact] ADMIN_EMAIL not configured — contact form submission lost. Set ADMIN_EMAIL in Netlify environment variables.');
    } else {
      // Notify admin
      await sendEmail({
        to:      adminEmail,
        subject: `📬 פנייה חדשה מהאתר — ${subject}`,
        html: `<div dir="rtl" style="font-family:Arial,sans-serif;font-size:15px;line-height:1.7;color:#1a1a1a;max-width:540px;margin:0 auto;padding:32px 24px;">
<h2 style="margin:0 0 20px;font-size:20px;">פנייה חדשה מהאתר</h2>
<p><strong>שם:</strong> ${name || '—'}</p>
<p><strong>אימייל:</strong> <a href="mailto:${email}">${email}</a></p>
<p><strong>נושא:</strong> ${subject}</p>
<hr style="border:none;border-top:1px solid #e5e5e5;margin:20px 0;">
<p style="white-space:pre-wrap">${message}</p>
<hr style="border:none;border-top:1px solid #e5e5e5;margin:20px 0;">
<p style="font-size:12px;color:#999;">נשלח מ-CampaignAI contact form · IP: ${context.ip}</p>
</div>`,
      }).catch(e => console.error('[contact] admin email failed:', e.message));
    }

    // Send confirmation to user
    await sendEmail({
      to:      email,
      subject: 'קיבלנו את פנייתך — נחזור אליך בהקדם',
      html: `<div dir="rtl" style="font-family:Arial,sans-serif;font-size:15px;line-height:1.7;color:#1a1a1a;max-width:540px;margin:0 auto;padding:32px 24px;">
<h2 style="margin:0 0 20px;font-size:20px;">קיבלנו את פנייתך ✔️</h2>
<p>${name ? `שלום ${name},` : 'שלום,'}</p>
<p>קיבלנו את הפנייה שלך ונחזור אליך בהקדם האפשרי.</p>
<p style="color:#64748b;font-size:13px;margin-top:20px;">תוכן הפנייה:<br><em>${message.slice(0, 300)}${message.length > 300 ? '...' : ''}</em></p>
<hr style="border:none;border-top:1px solid #e5e5e5;margin:20px 0;">
<p style="font-size:12px;color:#999;">— צוות CampaignAI</p>
</div>`,
    }).catch(e => console.error('[contact] confirmation email failed:', e.message));

    await writeRequestLog(buildLogPayload(context, 'info', 'contact_form_submitted', { email }));

    return ok({ message: 'הפנייה התקבלה! נחזור אליך בהקדם.' }, context.requestId);

  } catch (error) {
    await writeRequestLog(buildLogPayload(context, 'error', 'contact_form_failed', { code: error.code })).catch(() => {});
    return fail(error, context.requestId);
  }
};
