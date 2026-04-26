'use strict';
const { getAdminClient } = require('./_shared/supabase');

exports.handler = async (event) => {
  // Supports both GET (from email link) and POST (from settings UI)
  const email = _resolveEmail(event);

  if (!email) {
    return _html(400, 'קישור ההסרה אינו תקין. <a href="/">חזרה למערכת</a>');
  }

  try {
    const sb = getAdminClient();

    // Update marketing_consent in profiles by email
    const { error } = await sb
      .from('profiles')
      .update({ marketing_consent: false, marketing_consent_at: null })
      .eq('email', email.toLowerCase().trim());

    if (error) throw error;

    // Log the unsubscribe action
    await sb.from('audit_log').insert({
      action:      'marketing_unsubscribe',
      entity_type: 'profile',
      metadata:    { email, source: 'email_link' },
    }).catch(() => {});

    return _html(200, `
      <h2 style="color:#1e293b">הוסרת בהצלחה ✓</h2>
      <p style="color:#64748b">הכתובת <strong>${_escHtml(email)}</strong> הוסרה מרשימת הדיוור השיווקי.</p>
      <p style="color:#64748b;font-size:0.9rem">שים לב: מיילים תפעוליים (קבלות, איפוס סיסמה) ימשיכו להישלח.</p>
      <p style="margin-top:1.5rem"><a href="/" style="color:#6366f1">חזרה למערכת</a></p>
    `);
  } catch (err) {
    console.error('[unsubscribe] error:', err.message);
    return _html(500, 'אירעה שגיאה. אנא פנה אלינו ב-<a href="mailto:yakovymarkus@gmail.com">yakovymarkus@gmail.com</a>');
  }
};

function _resolveEmail(event) {
  // GET: /api/unsubscribe?e=base64encoded
  const qs = event.queryStringParameters || {};
  if (qs.e) {
    try { return Buffer.from(qs.e, 'base64').toString('utf8'); } catch { return null; }
  }
  // POST: { email: '...' }
  if (event.httpMethod === 'POST') {
    try {
      const body = JSON.parse(event.body || '{}');
      return body.email || null;
    } catch { return null; }
  }
  return null;
}

function _escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function _html(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>הסרה מרשימת תפוצה — CampaignBrain</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 480px; margin: 5rem auto; padding: 0 1.5rem; text-align: center; }
    a { color: #6366f1; }
  </style>
</head>
<body>
  <div style="font-size:2.5rem;margin-bottom:1rem">🧠</div>
  <h1 style="font-size:1.25rem;color:#1e293b;margin-bottom:1rem">CampaignBrain</h1>
  ${body}
</body>
</html>`,
  };
}
