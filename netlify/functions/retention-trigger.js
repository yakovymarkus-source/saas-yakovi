'use strict';
/**
 * retention-trigger.js
 * Scheduled — runs every hour via trigger-pending-jobs or cron
 * Checks for trigger conditions and sends notifications:
 *   - ליד ראשון
 *   - נפילת תנועה > 40%
 *   - 7 ימים ללא פעילות
 *   - Campaign score שיפור > 10 נקודות
 */

const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');

function db() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

const TRIGGERS = {
  first_lead: {
    check: async (supabase, userId) => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { count } = await supabase.from('raw_events')
        .select('id', { count: 'exact', head: true })
        .eq('event_type', 'form_submit');
      const { count: recent } = await supabase.from('raw_events')
        .select('id', { count: 'exact', head: true })
        .eq('event_type', 'form_submit')
        .gte('created_at', yesterday);
      // First ever lead received in last 24h
      return count === 1 && recent === 1;
    },
    subject: '🎉 קיבלת ליד ראשון!',
    body: (data) => `מזל טוב! הגולש הראשון השאיר פרטים בדף הנחיתה שלך.\n\nכנס לפלטפורמה כדי שה-AI ישלח לו הודעת פולו-אפ: ${data.appUrl}`,
  },
  traffic_drop: {
    check: async (supabase, userId) => {
      const now = Date.now();
      const week1Start = new Date(now - 14 * 86400000).toISOString();
      const week1End   = new Date(now - 7  * 86400000).toISOString();
      const week2Start = new Date(now - 7  * 86400000).toISOString();

      const { count: prevWeek } = await supabase.from('landing_page_sessions')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', week1Start).lte('created_at', week1End);
      const { count: thisWeek } = await supabase.from('landing_page_sessions')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', week2Start);

      if (!prevWeek || prevWeek < 10) return false;
      const drop = (prevWeek - thisWeek) / prevWeek;
      return drop > 0.4; // 40%+ drop
    },
    subject: '⚠️ התנועה שלך ירדה ב-40%',
    body: (data) => `שים לב — התנועה לדפי הנחיתה שלך ירדה בצורה משמעותית השבוע.\n\nיש הזדמנות לשיפור עכשיו: ${data.appUrl}`,
  },
  inactive_7_days: {
    check: async (supabase, userId) => {
      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
      const { data: profile } = await supabase.from('profiles')
        .select('last_seen_at').eq('id', userId).maybeSingle();
      return profile?.last_seen_at && new Date(profile.last_seen_at) < new Date(weekAgo);
    },
    subject: '👋 חזור לפלטפורמה — יש לך נתונים חדשים',
    body: (data) => `עברו 7 ימים מאז הכניסה האחרונה שלך.\nיש לך נתונים חדשים שמחכים לניתוח: ${data.appUrl}`,
  },
};

async function sendEmail(to, subject, text) {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) return;
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  });
  await transporter.sendMail({ from: process.env.GMAIL_USER, to, subject, text });
}

exports.handler = async (event) => {
  const supabase = db();
  const appUrl   = process.env.APP_URL || process.env.URL || '';

  // Get all active users
  const { data: users } = await supabase.auth.admin.listUsers({ perPage: 500 });
  if (!users?.users) return { statusCode: 200, body: JSON.stringify({ ok: true, checked: 0 }) };

  let fired = 0;
  for (const user of users.users) {
    for (const [triggerId, trigger] of Object.entries(TRIGGERS)) {
      try {
        // Check if this trigger already fired for this user today
        const todayKey = `retention_${triggerId}_${new Date().toISOString().slice(0, 10)}`;
        const { data: existing } = await supabase.from('user_achievements')
          .select('id').eq('user_id', user.id).eq('achievement_id', todayKey).maybeSingle();
        if (existing) continue;

        const shouldFire = await trigger.check(supabase, user.id);
        if (!shouldFire) continue;

        // Mark as fired
        await supabase.from('user_achievements').upsert(
          { user_id: user.id, achievement_id: todayKey, metadata: { triggered: new Date().toISOString() } },
          { onConflict: 'user_id,achievement_id', ignoreDuplicates: true }
        );

        // Send email
        if (user.email) {
          await sendEmail(user.email, trigger.subject, trigger.body({ appUrl }));
          fired++;
        }
      } catch (e) {
        console.warn(`[retention-trigger] ${triggerId} for ${user.id}:`, e.message);
      }
    }
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true, fired }) };
};
