'use strict';

/**
 * qa-uptime-check — runs every 10 minutes.
 * 1. DB ping via system_intelligence_logs
 * 2. Error rate check on system_intelligence_logs (new data)
 * 3. Error rate check on request_logs (existing production data)
 * 4. Periodic cleanup of old intelligence logs
 * 5. Email admin on any failure/spike
 */

const { getAdminClient } = require('./_shared/supabase');
const ADMIN_EMAIL        = process.env.ADMIN_EMAIL || 'yakovymarkus@gmail.com';
const IL_ERROR_THRESHOLD = 0.5;  // >50% errors in intelligence_logs → alert
const RL_ERROR_THRESHOLD = 0.3;  // >30% errors in request_logs → alert

exports.handler = async () => {
  const results = { db: false, ilErrorRate: null, rlErrorRate: null, alertsSent: [] };

  try {
    const sb    = getAdminClient();
    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();

    // 1 — DB ping (try request_logs which always exists)
    const { error: pingErr } = await sb
      .from('request_logs')
      .select('id', { count: 'exact', head: true })
      .limit(1);

    results.db = !pingErr;
    if (pingErr) {
      await sendAlert('🚨 DB connectivity failure', `Supabase ping failed: ${pingErr.message}`);
      results.alertsSent.push('db');
    }

    // 2 — system_intelligence_logs error rate (new QA data)
    const [ilTotal, ilErrors] = await Promise.all([
      sb.from('system_intelligence_logs').select('id', { count: 'exact', head: true }).gte('created_at', since),
      sb.from('system_intelligence_logs').select('id', { count: 'exact', head: true }).gte('created_at', since).in('status', ['TECH_ERROR','TIMEOUT']),
    ]).catch(() => [{ count: 0 }, { count: 0 }]);

    const ilT = ilTotal?.count || 0;
    const ilE = ilErrors?.count || 0;
    if (ilT >= 10) {
      results.ilErrorRate = ilE / ilT;
      if (results.ilErrorRate > IL_ERROR_THRESHOLD) {
        await sendAlert(
          `⚠️ High agent error rate: ${Math.round(results.ilErrorRate * 100)}%`,
          `${ilE} agent errors out of ${ilT} calls in the last 10 minutes (system_intelligence_logs).`
        );
        results.alertsSent.push('il_error_rate');
      }
    }

    // 3 — request_logs error rate (existing production logs)
    const [rlTotal, rlErrors] = await Promise.all([
      sb.from('request_logs').select('id', { count: 'exact', head: true }).gte('created_at', since),
      sb.from('request_logs').select('id', { count: 'exact', head: true }).gte('created_at', since).eq('level', 'error'),
    ]).catch(() => [{ count: 0 }, { count: 0 }]);

    const rlT = rlTotal?.count || 0;
    const rlE = rlErrors?.count || 0;
    if (rlT >= 20) {
      results.rlErrorRate = rlE / rlT;
      if (results.rlErrorRate > RL_ERROR_THRESHOLD) {
        await sendAlert(
          `⚠️ High API error rate: ${Math.round(results.rlErrorRate * 100)}%`,
          `${rlE} API errors out of ${rlT} requests in the last 10 minutes (request_logs).`
        );
        results.alertsSent.push('rl_error_rate');
      }
    }

    // 4 — Periodic cleanup (~once per day out of 144 runs)
    if (Math.random() < 1 / 144) {
      await sb.rpc('cleanup_intelligence_logs').catch(() => {});
    }

    return { statusCode: 200, body: JSON.stringify(results) };
  } catch (err) {
    await sendAlert('🚨 Uptime check crashed', err?.message || String(err)).catch(() => {});
    return { statusCode: 500, body: JSON.stringify({ error: err?.message }) };
  }
};

async function sendAlert(subject, detail) {
  try {
    const { sendEmail } = require('./_shared/email');
    await sendEmail({
      to:      ADMIN_EMAIL,
      subject: `CampaignAI — ${subject}`,
      html: `
        <h2 style="color:#ef4444;font-family:sans-serif">System Alert</h2>
        <p style="font-family:sans-serif"><b>${subject}</b></p>
        <p style="font-family:sans-serif">${detail}</p>
        <p style="font-family:sans-serif;color:#6b7280"><b>Time:</b> ${new Date().toISOString()}</p>
        <hr/>
        <p style="font-family:sans-serif;font-size:.85rem;color:#9ca3af">CampaignAI QA Monitoring</p>
      `,
    });
  } catch (_) {}
}
