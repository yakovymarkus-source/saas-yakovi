'use strict';
/**
 * team-invite.js
 * POST /api/team-invite   { email, role? }           → invite new member
 * GET  /api/team-invite                              → list team members
 * DELETE /api/team-invite?memberId=xxx               → remove member
 *
 * Roles: owner | admin | viewer  (default: viewer)
 */

const { createClient }   = require('@supabase/supabase-js');
const { sendEmail }      = require('./_shared/email');

const ALLOWED_ROLES = ['admin', 'viewer'];

function db()   { return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY); }
function anon() { return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY); }

async function authUser(token) {
  const { data: { user }, error } = await anon().auth.getUser(token);
  if (error || !user) return null;
  return user;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, body: '' };

  const token = (event.headers['authorization'] || '').replace('Bearer ', '');
  if (!token) return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };

  const user = await authUser(token);
  if (!user) return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };

  const supabase = db();
  const appUrl   = process.env.APP_URL || process.env.URL || '';

  // ── LIST ──────────────────────────────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    const { data, error } = await supabase
      .from('team_members')
      .select('id, invited_email, role, status, invited_at, joined_at')
      .eq('owner_user_id', user.id)
      .order('invited_at', { ascending: false });

    if (error) return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok: true, members: data || [] }),
    };
  }

  // ── DELETE ────────────────────────────────────────────────────────────────
  if (event.httpMethod === 'DELETE') {
    const memberId = event.queryStringParameters?.memberId;
    if (!memberId) return { statusCode: 400, body: JSON.stringify({ error: 'memberId required' }) };

    const { error } = await supabase
      .from('team_members')
      .delete()
      .eq('id', memberId)
      .eq('owner_user_id', user.id); // only owner can delete

    if (error) return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  }

  // ── INVITE (POST) ─────────────────────────────────────────────────────────
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const invitedEmail = (body.email || '').trim().toLowerCase();
  const role         = ALLOWED_ROLES.includes(body.role) ? body.role : 'viewer';

  if (!invitedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(invitedEmail)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'כתובת אימייל לא תקינה' }) };
  }

  // Check plan — team members are a paid feature
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('plan')
    .eq('user_id', user.id)
    .maybeSingle();

  const paidPlans = ['early_bird', 'starter', 'pro', 'agency'];
  if (!paidPlans.includes(sub?.plan)) {
    return { statusCode: 403, body: JSON.stringify({ error: 'תכונת צוות זמינה בתוכניות בתשלום בלבד' }) };
  }

  // Check member count limit
  const limits = { early_bird: 2, starter: 3, pro: 10, agency: 50 };
  const maxMembers = limits[sub?.plan] || 2;
  const { count } = await supabase
    .from('team_members')
    .select('id', { count: 'exact', head: true })
    .eq('owner_user_id', user.id);

  if (count >= maxMembers) {
    return { statusCode: 403, body: JSON.stringify({ error: `הגעת למגבלת ${maxMembers} חברי צוות בתוכנית שלך` }) };
  }

  // Check if already invited
  const { data: existing } = await supabase
    .from('team_members')
    .select('id, status')
    .eq('owner_user_id', user.id)
    .eq('invited_email', invitedEmail)
    .maybeSingle();

  if (existing) {
    return { statusCode: 409, body: JSON.stringify({ error: `${invitedEmail} כבר הוזמן/ה לצוות` }) };
  }

  // Generate secure invite token
  const inviteToken = require('crypto').randomBytes(24).toString('hex');

  const { data: member, error: insertErr } = await supabase
    .from('team_members')
    .insert({
      owner_user_id: user.id,
      invited_email: invitedEmail,
      role,
      status:        'pending',
      invite_token:  inviteToken,
      invited_at:    new Date().toISOString(),
    })
    .select('id')
    .single();

  if (insertErr) return { statusCode: 500, body: JSON.stringify({ error: insertErr.message }) };

  // Get inviter's name/email
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, email')
    .eq('id', user.id)
    .maybeSingle();

  const inviterName = profile?.full_name || user.email || 'חשבון CampaignAI';
  const acceptUrl   = `${appUrl}/?invite=${inviteToken}`;

  // Send invite email
  try {
    await sendEmail({
      to:      invitedEmail,
      subject: `${inviterName} הזמין/ה אותך לצוות CampaignAI`,
      html: `
        <div dir="rtl" style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#1e293b">
          <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:2rem;border-radius:16px 16px 0 0;text-align:center">
            <h1 style="color:#fff;margin:0;font-size:1.5rem">הוזמנת לצוות 🎉</h1>
          </div>
          <div style="background:#f8fafc;padding:2rem;border-radius:0 0 16px 16px;border:1px solid #e2e8f0">
            <p style="font-size:1rem;margin-bottom:1rem">
              <strong>${inviterName}</strong> הזמין/ה אותך להצטרף לצוות שלהם ב-CampaignAI כ-<strong>${role === 'admin' ? 'מנהל/ת' : 'צופה'}</strong>.
            </p>
            <p style="color:#64748b;font-size:0.9rem">CampaignAI הוא פלטפורמת AI לניהול קמפיינים ושיווק דיגיטלי.</p>
            <div style="text-align:center;margin:2rem 0">
              <a href="${acceptUrl}" style="display:inline-block;padding:0.875rem 2rem;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;text-decoration:none;border-radius:12px;font-weight:700;font-size:1rem">
                קבל את ההזמנה ←
              </a>
            </div>
            <p style="color:#94a3b8;font-size:0.75rem;text-align:center">
              הקישור תקף ל-7 ימים. אם לא ביקשת זאת, תוכל להתעלם מאימייל זה.
            </p>
          </div>
        </div>`,
    });
  } catch (emailErr) {
    console.warn('[team-invite] email failed:', emailErr.message);
    // Don't fail the invite — it was saved to DB
  }

  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ok: true, memberId: member.id, email: invitedEmail }),
  };
};
