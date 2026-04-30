'use strict';

/**
 * intelligence-logger.js
 * Fire-and-forget logger for system_intelligence_logs.
 * Sampling: 100% errors/failures, 10% successes (to control storage).
 * Latency alert: emails admin if latency_ms > 15000.
 */

const { getAdminClient } = require('./supabase');
const LATENCY_ALERT_MS   = 15_000;
const ADMIN_EMAIL        = process.env.ADMIN_EMAIL || 'yakovymarkus@gmail.com';
const ENV                = process.env.ENVIRONMENT || process.env.CONTEXT || 'production';

/**
 * log(entry) — write one row. Always fire-and-forget (never throws).
 *
 * Required fields:
 *   agent_name      string
 *   interaction_type  'ui_click'|'api_call'|'agent_logic'|'llm_call'|'webhook'|'scheduled'
 *   status          'SUCCESS'|'LOGIC_FAIL'|'TECH_ERROR'|'TIMEOUT'|'PARTIAL'
 *
 * Optional:
 *   trace_id, parent_trace_id, user_id, user_input,
 *   agent_reasoning (object), final_output, latency_ms, error_details
 */
async function log(entry) {
  try {
    const isFailure = entry.status !== 'SUCCESS';

    // Sampling: skip 90% of successes
    if (!isFailure && Math.random() > 0.1) return;

    const row = {
      agent_name:       entry.agent_name,
      interaction_type: entry.interaction_type,
      status:           entry.status,
      environment:      ENV,
      trace_id:         entry.trace_id        || undefined,
      parent_trace_id:  entry.parent_trace_id || undefined,
      user_id:          entry.user_id         || undefined,
      user_input:       entry.user_input       ? String(entry.user_input).slice(0, 2000)    : undefined,
      agent_reasoning:  entry.agent_reasoning  || undefined,
      final_output:     entry.final_output     ? String(entry.final_output).slice(0, 4000)  : undefined,
      latency_ms:       typeof entry.latency_ms === 'number' ? entry.latency_ms : undefined,
      error_details:    entry.error_details    ? String(entry.error_details).slice(0, 2000) : undefined,
    };

    // Remove undefined keys
    Object.keys(row).forEach(k => row[k] === undefined && delete row[k]);

    await getAdminClient().from('system_intelligence_logs').insert(row);

    // Latency alert
    if (typeof entry.latency_ms === 'number' && entry.latency_ms > LATENCY_ALERT_MS) {
      sendLatencyAlert(entry).catch(() => {});
    }
  } catch (_) {
    // Never crash the caller
  }
}

/**
 * wrap(fn, meta) — wraps an async function, auto-logs timing + status.
 *
 * Usage:
 *   const result = await wrap(
 *     () => callClaude(prompt),
 *     { agent_name: 'campaigner', interaction_type: 'llm_call', user_id, trace_id }
 *   );
 */
async function wrap(fn, meta = {}) {
  const start = Date.now();
  try {
    const result = await fn();
    log({ ...meta, status: 'SUCCESS', latency_ms: Date.now() - start });
    return result;
  } catch (err) {
    log({
      ...meta,
      status:        'TECH_ERROR',
      latency_ms:    Date.now() - start,
      error_details: err?.message || String(err),
    });
    throw err;
  }
}

async function sendLatencyAlert(entry) {
  try {
    const { sendEmail } = require('./email');
    await sendEmail({
      to:      ADMIN_EMAIL,
      subject: `⚠️ CampaignAI — latency alert: ${entry.agent_name}`,
      html: `
        <h2 style="color:#f59e0b">Latency Alert</h2>
        <p><b>Agent:</b> ${entry.agent_name}</p>
        <p><b>Type:</b> ${entry.interaction_type}</p>
        <p><b>Latency:</b> ${entry.latency_ms}ms (threshold: ${LATENCY_ALERT_MS}ms)</p>
        <p><b>Status:</b> ${entry.status}</p>
        ${entry.error_details ? `<p><b>Error:</b> ${entry.error_details}</p>` : ''}
        <p><b>Time:</b> ${new Date().toISOString()}</p>
        <p><b>Environment:</b> ${ENV}</p>
      `,
    });
  } catch (_) {}
}

module.exports = { log, wrap };
