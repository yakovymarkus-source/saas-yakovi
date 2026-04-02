/**
 * email.js — Resend email service wrapper
 *
 * Usage:
 *   const { sendEmail, sendWelcome, sendBillingConfirmation } = require('./email');
 *   await sendWelcome({ to: 'user@example.com', name: 'Yakov' });
 */

const { optionalEnv } = require('./env');

const RESEND_API_URL = 'https://api.resend.com/emails';

async function sendEmail({ to, subject, html, replyTo }) {
  const apiKey   = process.env.RESEND_API_KEY;
  const from     = process.env.EMAIL_FROM     || 'noreply@yourdomain.com';
  const replyToAddr = replyTo || process.env.EMAIL_REPLY_TO || from;

  if (!apiKey) {
    console.warn('[email] RESEND_API_KEY not set — skipping email send');
    return null;
  }

  const res = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to, reply_to: replyToAddr, subject, html }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`[email] Send failed (${res.status}):`, body);
    return null;
  }
  return res.json();
}

// ─── Transactional email templates ───────────────────────────────────────────

async function sendWelcome({ to, name }) {
  return sendEmail({
    to,
    subject: 'ברוכים הבאים! 🎉',
    html: `
      <h1>שלום ${name || ''}!</h1>
      <p>החשבון שלך נוצר בהצלחה.</p>
      <p>כדי להתחיל, חבר את חשבונות הפרסום שלך (Google Ads, Meta, GA4) בהגדרות.</p>
      <p><a href="${process.env.APP_URL}/settings/integrations">לחץ כאן להתחיל</a></p>
      <hr/>
      <small>אם לא יצרת חשבון זה, התעלם מהמייל.</small>
    `,
  });
}

async function sendBillingConfirmation({ to, name, planName, amount, currency = 'USD' }) {
  return sendEmail({
    to,
    subject: `קבלה — מנוי ${planName}`,
    html: `
      <h1>תודה על המנוי!</h1>
      <p>שלום ${name || ''},</p>
      <p>קיבלנו את התשלום עבור תוכנית <strong>${planName}</strong>.</p>
      <p>סכום: <strong>${amount} ${currency}</strong></p>
      <p><a href="${process.env.APP_URL}/settings/billing">צפה בפרטי החיוב</a></p>
    `,
  });
}

async function sendTrialEndingWarning({ to, name, daysLeft }) {
  return sendEmail({
    to,
    subject: `תקופת הניסיון שלך מסתיימת בעוד ${daysLeft} ימים`,
    html: `
      <h1>שלום ${name || ''},</h1>
      <p>תקופת הניסיון החינמית שלך מסתיימת בעוד <strong>${daysLeft} ימים</strong>.</p>
      <p>שדרג עכשיו כדי לא לאבד גישה לנתונים שלך.</p>
      <p><a href="${process.env.APP_URL}/settings/billing">שדרג עכשיו</a></p>
    `,
  });
}

async function sendAccountDeletedConfirmation({ to, name }) {
  return sendEmail({
    to,
    subject: 'החשבון שלך נמחק',
    html: `
      <h1>שלום ${name || ''},</h1>
      <p>החשבון שלך נמחק בהצלחה.</p>
      <p>כל הנתונים שלך יוסרו תוך 30 ימים בהתאם למדיניות הפרטיות שלנו.</p>
      <p>אם זו הייתה טעות, צור איתנו קשר בהקדם.</p>
    `,
  });
}

async function sendSyncCompleted({ to, name, campaignId, analysisId, verdict }) {
  return sendEmail({
    to,
    subject: `ניתוח קמפיין הסתיים — ${verdict}`,
    html: `
      <h1>שלום ${name || ''},</h1>
      <p>הניתוח עבור קמפיין <strong>${campaignId}</strong> הסתיים.</p>
      <p>תוצאה: <strong>${verdict}</strong></p>
      <p><a href="${process.env.APP_URL}/campaigns/${campaignId}/analysis/${analysisId}">צפה בניתוח המלא</a></p>
    `,
  });
}

module.exports = {
  sendEmail,
  sendWelcome,
  sendBillingConfirmation,
  sendTrialEndingWarning,
  sendAccountDeletedConfirmation,
  sendSyncCompleted,
};
