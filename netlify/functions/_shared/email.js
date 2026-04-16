/**
 * email.js — Resend email service wrapper
 *
 * Usage:
 *   const { sendWelcome, sendBillingConfirmation, sendPaymentFailed, sendSubscriptionRenewed, sendSubscriptionCanceled } = require('./email');
 *   await sendWelcome({ to: 'user@example.com' });
 */

const RESEND_API_URL = 'https://api.resend.com/emails';

async function sendEmail({ to, subject, html, replyTo }) {
  const apiKey   = process.env.RESEND_API_KEY;
  const from     = process.env.EMAIL_FROM     || 'noreply@yourdomain.com';
  const replyToAddr = replyTo || process.env.EMAIL_REPLY_TO || from;

  if (!apiKey) {
    // Log as error — this should be visible in Netlify function logs
    console.error('[email] RESEND_API_KEY not configured — email not sent. Set RESEND_API_KEY in Netlify environment variables.');
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
    console.error(`[email] Resend API error (${res.status}): ${body} — to: ${to}, subject: ${subject}`);
    return null;
  }
  return res.json();
}

// ─── Transactional email templates ───────────────────────────────────────────

const APP_URL     = () => process.env.APP_URL     || '';
const BILLING_URL = () => `${APP_URL()}/settings/billing`;

const WRAPPER_OPEN  = `<div dir="rtl" style="font-family:Arial,sans-serif;font-size:15px;line-height:1.7;color:#1a1a1a;max-width:540px;margin:0 auto;padding:32px 24px;">`;
const WRAPPER_CLOSE = `<hr style="border:none;border-top:1px solid #e5e5e5;margin:32px 0 16px;"><p style="font-size:12px;color:#999;margin:0;">CampaignBrain — מערכת ניהול קמפיינים חכמה</p></div>`;

const btn = (href, text) =>
  `<p style="margin:28px 0;"><a href="${href}" style="display:inline-block;background:#111;color:#fff;padding:13px 26px;text-decoration:none;border-radius:7px;font-weight:bold;font-size:15px;">${text}</a></p>`;

// 1. הרשמה
async function sendWelcome({ to }) {
  return sendEmail({
    to,
    subject: 'ברוך הבא למערכת — מתחילים לעבוד',
    html: `${WRAPPER_OPEN}
<h2 style="margin:0 0 20px;font-size:22px;">ברוך הבא 👋</h2>
<p>נרשמת למערכת — ועכשיו מתחיל החלק האמיתי.</p>
<p>המטרה כאן פשוטה:<br>
לא לבזבז זמן על ניסוי וטעייה — אלא לבנות שיווק שעובד.</p>
${btn(APP_URL(), 'כניסה למערכת')}
<p>אם אתה כאן — כנראה שאתה מחפש תוצאות, לא רעש.<br>
אז בוא נתחיל לעבוד.</p>
<p style="margin-top:24px;">— צוות CampaignBrain</p>
${WRAPPER_CLOSE}`,
  });
}

// 2. תשלום התקבל / הופעל
async function sendBillingConfirmation({ to }) {
  return sendEmail({
    to,
    subject: 'התשלום התקבל — אפשר להתחיל',
    html: `${WRAPPER_OPEN}
<h2 style="margin:0 0 20px;font-size:22px;">התשלום התקבל ✔️</h2>
<p>המנוי שלך הופעל בהצלחה.</p>
<p style="margin:16px 0 8px;"><strong>מה זה אומר בפועל?</strong></p>
<ul style="padding-right:20px;margin:0 0 16px;">
  <li>גישה מלאה לכל הכלים</li>
  <li>יצירת קמפיינים ותוצרים שיווקיים</li>
  <li>שליטה מלאה על התהליך</li>
</ul>
${btn(APP_URL(), 'כניסה למערכת')}
<p>מכאן — זה כבר תלוי בך.<br>
תשתמש בזה נכון — וזה יעבוד.</p>
<p style="margin-top:24px;">— צוות CampaignBrain</p>
${WRAPPER_CLOSE}`,
  });
}

// 3. כשל תשלום
async function sendPaymentFailed({ to }) {
  return sendEmail({
    to,
    subject: 'הייתה בעיה בתשלום שלך',
    html: `${WRAPPER_OPEN}
<h2 style="margin:0 0 20px;font-size:22px;">שנייה לפני שנעצור ⚠️</h2>
<p>ניסינו לחייב את אמצעי התשלום שלך — וזה לא עבר.</p>
<p>זה קורה.<br>אבל בלי עדכון — הגישה שלך תוגבל בקרוב.</p>
${btn(BILLING_URL(), 'עדכון פרטי תשלום')}
<p>אל תחכה לרגע האחרון.<br>
עדכן עכשיו וחזור לעבוד.</p>
<p style="margin-top:24px;">— צוות CampaignBrain</p>
${WRAPPER_CLOSE}`,
  });
}

// 4. חידוש מנוי
async function sendSubscriptionRenewed({ to }) {
  return sendEmail({
    to,
    subject: 'המנוי שלך חודש',
    html: `${WRAPPER_OPEN}
<h2 style="margin:0 0 20px;font-size:22px;">המנוי חודש ✔️</h2>
<p>המנוי שלך חודש בהצלחה לתקופה נוספת.</p>
<p>הגישה שלך למערכת ממשיכה כרגיל — אין צורך בשום פעולה.</p>
${btn(APP_URL(), 'כניסה למערכת')}
<p>זה בדיוק הזמן להוציא עוד תוצאה.</p>
<p style="margin-top:24px;">— צוות CampaignBrain</p>
${WRAPPER_CLOSE}`,
  });
}

// 5. ביטול מנוי
async function sendSubscriptionCanceled({ to }) {
  return sendEmail({
    to,
    subject: 'המנוי בוטל',
    html: `${WRAPPER_OPEN}
<h2 style="margin:0 0 20px;font-size:22px;">המנוי בוטל</h2>
<p>המנוי שלך בוטל.</p>
<p>הגישה למערכת תישאר זמינה עד סוף התקופה ששולמה.</p>
<p>אם תרצה לחזור בכל שלב — המערכת מחכה לך.</p>
${btn(APP_URL(), 'חזרה למערכת')}
<p style="margin-top:24px;">— צוות CampaignBrain</p>
${WRAPPER_CLOSE}`,
  });
}

// שמור לשימוש פנימי / אדמין
async function sendActivationEmail({ to, name, planLabel }) {
  const greeting = name ? `שלום ${name},` : 'שלום,';
  const planLine = planLabel ? `<p><strong>תוכנית:</strong> ${planLabel}</p>` : '';
  return sendEmail({
    to,
    subject: 'החשבון שלך הופעל — אפשר להתחיל',
    html: `${WRAPPER_OPEN}
<h2 style="margin:0 0 20px;font-size:22px;">החשבון הופעל ✔️</h2>
<p>${greeting}</p>
<p>התשלום שלך אומת והחשבון הופעל בהצלחה.</p>
${planLine}
<p style="margin:16px 0 8px;"><strong>מה זה אומר בפועל?</strong></p>
<ul style="padding-right:20px;margin:0 0 16px;">
  <li>גישה מלאה לכל הכלים</li>
  <li>יצירת תסריטי מודעות ודפי נחיתה</li>
  <li>ניתוח ביצועי קמפיינים בזמן אמת</li>
</ul>
${btn(APP_URL(), 'כניסה למערכת')}
<p>מכאן — זה כבר תלוי בך.</p>
<p style="margin-top:24px;">— צוות CampaignAI</p>
${WRAPPER_CLOSE}`,
  });
}

async function sendAdminPaymentAlert({ adminEmail, userEmail, userName, plan }) {
  return sendEmail({
    to: adminEmail,
    subject: `💳 תשלום ממתין לאישור — ${userEmail}`,
    html: `${WRAPPER_OPEN}
<h2 style="margin:0 0 20px;font-size:22px;">תשלום ממתין לאישור</h2>
<p><strong>משתמש:</strong> ${userName || userEmail}</p>
<p><strong>אימייל:</strong> ${userEmail}</p>
<p><strong>תוכנית:</strong> ${plan}</p>
${btn(APP_URL(), 'פתח לוח ניהול')}
${WRAPPER_CLOSE}`,
  });
}

async function sendSyncCompleted({ to, campaignId, analysisId, verdict }) {
  return sendEmail({
    to,
    subject: `ניתוח קמפיין הסתיים — ${verdict}`,
    html: `${WRAPPER_OPEN}
<h2 style="margin:0 0 20px;font-size:22px;">הניתוח הסתיים ✔️</h2>
<p>הניתוח עבור קמפיין <strong>${campaignId}</strong> מוכן.</p>
<p>תוצאה: <strong>${verdict}</strong></p>
${btn(`${APP_URL()}/campaigns/${campaignId}/analysis/${analysisId}`, 'צפה בניתוח המלא')}
<p style="margin-top:24px;">— צוות CampaignBrain</p>
${WRAPPER_CLOSE}`,
  });
}

// 6. ליד חדש — התראה לבעל העסק
async function sendNewLeadAdmin({ to, leadName, leadPhone, leadEmail, businessName, assetTitle }) {
  const contactLines = [
    leadName  ? `<p><strong>שם:</strong> ${leadName}</p>`   : '',
    leadPhone ? `<p><strong>טלפון:</strong> <a href="tel:${leadPhone}" style="color:#111">${leadPhone}</a></p>` : '',
    leadEmail ? `<p><strong>מייל:</strong> <a href="mailto:${leadEmail}" style="color:#111">${leadEmail}</a></p>` : '',
  ].filter(Boolean).join('');

  return sendEmail({
    to,
    subject: `ליד חדש הגיע — ${leadName || leadPhone || leadEmail}`,
    html: `${WRAPPER_OPEN}
<h2 style="margin:0 0 20px;font-size:22px;">🎯 ליד חדש!</h2>
<p>מישהו השאיר פרטים דרך <strong>${assetTitle || 'דף הנחיתה'}</strong>${businessName ? ` של ${businessName}` : ''}.</p>
<div style="background:#f8fafc;border-right:4px solid #111;padding:16px 20px;border-radius:0 8px 8px 0;margin:20px 0;">
${contactLines}
</div>
${btn(APP_URL(), 'צפה בכל הלידים')}
<p style="font-size:13px;color:#666;">ממליצים ליצור קשר תוך שעה — הסיכויי ההמרה גבוהים משמעותית.</p>
${WRAPPER_CLOSE}`,
  });
}

// 7. תגובה אוטומטית ללד — אישור קבלה
async function sendLeadAutoReply({ to, leadName, businessName, assetTitle }) {
  const greeting = leadName ? `היי ${leadName},` : 'שלום,';
  const biz = businessName || 'העסק';

  return sendEmail({
    to,
    subject: `קיבלנו את הפרטים שלך — נחזור אליך בקרוב`,
    html: `${WRAPPER_OPEN}
<h2 style="margin:0 0 20px;font-size:22px;">תודה! 🙌</h2>
<p>${greeting}</p>
<p>הפרטים שלך הגיעו אלינו בהצלחה דרך <strong>${assetTitle || 'דף הנחיתה'}</strong>.</p>
<p>הצוות של <strong>${biz}</strong> יצור איתך קשר בהקדם האפשרי.</p>
<p style="margin-top:24px;font-size:13px;color:#666;">קיבלת מייל זה כי מילאת טופס פנייה. לא ביקשת? פשוט התעלם.</p>
${WRAPPER_CLOSE}`,
  });
}

module.exports = {
  sendEmail,
  sendWelcome,
  sendBillingConfirmation,
  sendPaymentFailed,
  sendSubscriptionRenewed,
  sendSubscriptionCanceled,
  sendActivationEmail,
  sendAdminPaymentAlert,
  sendSyncCompleted,
  sendNewLeadAdmin,
  sendLeadAutoReply,
};
