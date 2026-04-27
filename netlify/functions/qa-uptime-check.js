'use strict';

/**
 * qa-uptime-check — runs every 10 minutes.
 * 1. Pings Supabase (agent_reasoning table) to confirm DB connectivity.
 * 2. Checks for sustained high-error-rate in the last 10 min.
 * 3. Cleans up intelligence logs older than 30 days (once per day, ~144 runs → 1/144 chance).
 * 4. Emails admin on failure.
 */

const { getAdminClient } = require('./_shared/supabase');
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'yakovymarkus@gmail.com';
const ERROR_RATE_THRESHOLD = 0.5; // alert if >50% errors in last 10 min

exports.handler = async () => {
  const results = { db: false, errorRate: null, alertSent: false };

  try {
    const sb    = getAdminClient();
    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();

    // 1 — DB ping
    const { error: pingErr } = await sb
      .from('system_intelligence_logs')
      .select('id', { count: 'exact', head: true })
      .limit(1);

    results.db = !pingErr;

    if (pingErr) {
      await sendAlert('DB connectivity failure', `Supabase ping failed: ${pingErr.message}`);
      results.alertSent = true;
    }

    // 2 — Error rate check
    const [totalRes, errorRes] = await Promise.all([
      sb.from('system_intelligence_logs').select('id', { count: 'exact', head: true }).gte('created_at', since),
      sb.from('system_intelligence_logs').select('id', { count: 'exact', head: true }).gte('created_at', since).in('status', ['TECH_ERROR', 'TIMEOUT']),
    ]);

    const total  = totalRes.count || 0;
    const errors = errorRes.count || 0;
    if (total >= 10) {
      results.errorRate = errors / total;
      if (results.errorRate > ERROR_RATE_THRESHOLD) {
        await sendAlert(
          `High error rate: ${Math.round(results.errorRate * 100)}%`,
          `${errors} errors out of ${total} logs in the last 10 minutes.`
        );
        results.alertSent = true;
      }
    }

    // 3 — Periodic cleanup (roughly once per day)
    if (Math.random() < 1 / 144) {
      await sb.rpc('cleanup_intelligence_logs').catch(() => {});
    }

    return { statusCode: 200, body: JSON.stringify(results) };
  } catch (err) {
    await sendAlert('Uptime check crashed', err?.message || String(err)).catch(() => {});
    return { statusCode: 500, body: JSON.stringify({ error: err?.message }) };
  }
};

async function sendAlert(subject, detail) {
  try {
    const { sendEmail } = require('./_shared/email');
    await sendEmail({
      to:      ADMIN_EMAIL,
      subject: `🚨 CampaignAI — ${subject}`,
      html: `
        <h2 style="color:#ef4444">System Alert</h2>
        <p><b>${subject}</b></p>
        <p>${detail}</p>
        <p><b>Time:</b> ${new Date().toISOString()}</p>
      `,
    });
  } catch (_) {}
}
