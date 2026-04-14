'use strict';

/**
 * supabase-auth-email.js
 *
 * Supabase Auth Hook — "Send Email" webhook.
 * Replaces Supabase SMTP with direct Resend HTTP API calls.
 *
 * Supabase calls this endpoint whenever it needs to send an auth email:
 *   - Signup confirmation
 *   - Password reset
 *   - Magic link
 *   - Email change
 *
 * Configure in Supabase Dashboard:
 *   Authentication → Hooks → Send Email → enable + set URL to this function
 *
 * Docs: https://supabase.com/docs/guides/auth/auth-hooks#send-email-hook
 */

const RESEND_API_URL = 'https://api.resend.com/emails';

const WRAPPER_OPEN  = `<div dir="rtl" style="font-family:Arial,sans-serif;font-size:15px;line-height:1.7;color:#1a1a1a;max-width:540px;margin:0 auto;padding:32px 24px;">`;
const WRAPPER_CLOSE = `<hr style="border:none;border-top:1px solid #e5e5e5;margin:32px 0 16px;"><p style="font-size:12px;color:#999;margin:0;">CampaignBrain — מערכת ניהול קמפיינים חכמה</p></div>`;
const btn = (href, text) => `<p style="margin:28px 0;"><a href="${href}" style="display:inline-block;background:#111;color:#fff;padding:13px 26px;text-decoration:none;border-radius:7px;font-weight:bold;font-size:15px;">${text}</a></p>`;

function buildEmailHtml(actionType, confirmationUrl, token) {
  switch (actionType) {
    case 'signup':
    case 'email_confirmation':
      return `${WRAPPER_OPEN}
<h2 style="margin:0 0 20px;font-size:22px;">אמת את כתובת המייל שלך</h2>
<p>תודה שנרשמת ל-CampaignBrain.</p>
<p>לחץ על הכפתור כדי לאמת את כתובת המייל שלך ולהתחיל:</p>
${btn(confirmationUrl, 'אמת אימייל')}
<p style="font-size:13px;color:#666;">הקישור תקף לשעה אחת. אם לא נרשמת — התעלם מהודעה זו.</p>
${WRAPPER_CLOSE}`;

    case 'recovery':
    case 'reset_password':
      return `${WRAPPER_OPEN}
<h2 style="margin:0 0 20px;font-size:22px;">איפוס סיסמה</h2>
<p>קיבלנו בקשה לאיפוס הסיסמה לחשבון שלך.</p>
${btn(confirmationUrl, 'איפוס סיסמה')}
<p style="font-size:13px;color:#666;">הקישור תקף ל-60 דקות. אם לא ביקשת איפוס — התעלם מהודעה זו.</p>
${WRAPPER_CLOSE}`;

    case 'magiclink':
      return `${WRAPPER_OPEN}
<h2 style="margin:0 0 20px;font-size:22px;">קישור כניסה</h2>
<p>לחץ כדי להיכנס ל-CampaignBrain — ללא סיסמה:</p>
${btn(confirmationUrl, 'כניסה למערכת')}
<p style="font-size:13px;color:#666;">הקישור תקף ל-10 דקות ולשימוש חד פעמי.</p>
${WRAPPER_CLOSE}`;

    case 'email_change':
      return `${WRAPPER_OPEN}
<h2 style="margin:0 0 20px;font-size:22px;">אישור שינוי מייל</h2>
<p>קיבלנו בקשה לשנות את כתובת המייל שלך.</p>
${btn(confirmationUrl, 'אשר שינוי מייל')}
<p style="font-size:13px;color:#666;">אם לא ביקשת שינוי — פנה לתמיכה מיד.</p>
${WRAPPER_CLOSE}`;

    default:
      return `${WRAPPER_OPEN}
<h2 style="margin:0 0 20px;font-size:22px;">פעולה נדרשת</h2>
${btn(confirmationUrl, 'לחץ כאן')}
${WRAPPER_CLOSE}`;
  }
}

function getSubject(actionType) {
  switch (actionType) {
    case 'signup':
    case 'email_confirmation': return 'אמת את כתובת המייל שלך — CampaignBrain';
    case 'recovery':
    case 'reset_password':     return 'איפוס סיסמה — CampaignBrain';
    case 'magiclink':          return 'קישור כניסה — CampaignBrain';
    case 'email_change':       return 'אישור שינוי מייל — CampaignBrain';
    default:                   return 'הודעה מ-CampaignBrain';
  }
}

function json(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  // Supabase only calls this via POST
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' }, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  let payload;
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : (event.body || '');
    payload = JSON.parse(raw);
  } catch (_) {
    return json(400, { error: 'Invalid JSON' });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('[supabase-auth-email] RESEND_API_KEY not set');
    return json(500, { error: 'Email service not configured' });
  }

  // Supabase hook payload shape
  const userEmail    = payload.user?.email || payload.email_data?.email;
  const emailData    = payload.email_data  || {};
  const actionType   = emailData.email_action_type || payload.type || 'signup';

  // Build confirmation URL from token_hash (preferred) or token
  const siteUrl   = emailData.site_url || process.env.APP_URL || 'https://campaignbrain.netlify.app';
  const tokenHash = emailData.token_hash || emailData.token;
  const redirectTo = emailData.redirect_to || siteUrl;

  // Construct the confirmation URL as Supabase expects
  let confirmationUrl = emailData.confirm_email_url || '';

  if (!confirmationUrl && tokenHash) {
    const base = `${siteUrl}/auth/v1/verify`;
    const params = new URLSearchParams({
      token_hash: tokenHash,
      type: actionType === 'recovery' || actionType === 'reset_password' ? 'recovery'
          : actionType === 'magiclink' ? 'magiclink'
          : actionType === 'email_change' ? 'email_change'
          : 'signup',
      next: redirectTo,
    });
    confirmationUrl = `${base}?${params}`;
  }

  if (!userEmail) {
    console.error('[supabase-auth-email] Missing user email in payload:', JSON.stringify(payload).slice(0, 200));
    return json(400, { error: 'Missing email' });
  }

  if (!confirmationUrl) {
    console.error('[supabase-auth-email] Could not build confirmation URL. Payload:', JSON.stringify(payload).slice(0, 300));
    return json(400, { error: 'Missing confirmation URL' });
  }

  const subject = getSubject(actionType);
  const html    = buildEmailHtml(actionType, confirmationUrl, tokenHash);

  try {
    const res = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from:    'CampaignBrain <onboarding@resend.dev>',
        to:      [userEmail],
        subject,
        html,
      }),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      console.error(`[supabase-auth-email] Resend error (${res.status}):`, errBody);
      return json(500, { error: 'Failed to send email' });
    }

    const result = await res.json();
    console.log(`[supabase-auth-email] Sent ${actionType} to ${userEmail} — id: ${result.id}`);

    // Supabase hook expects {} on success
    return json(200, {});

  } catch (err) {
    console.error('[supabase-auth-email] Network error:', err.message);
    return json(500, { error: err.message });
  }
};
