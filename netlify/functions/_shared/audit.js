/**
 * audit.js — Write immutable audit entries for sensitive operations.
 *
 * Every call to writeAudit is fire-and-forget; it never throws so it
 * cannot interrupt the main request flow.
 */

const { getAdminClient } = require('./supabase');

/**
 * @param {object} opts
 * @param {string}  opts.userId      — acting user (uuid)
 * @param {string}  opts.action      — e.g. 'account.delete', 'integration.create'
 * @param {string}  [opts.targetId]  — resource being acted on
 * @param {string}  [opts.targetType]— e.g. 'campaign', 'integration'
 * @param {object}  [opts.metadata]  — arbitrary extra context (no secrets!)
 * @param {string}  [opts.ip]        — originating IP
 * @param {string}  [opts.requestId] — trace ID
 */
async function writeAudit({ userId, action, targetId, targetType, metadata = {}, ip, requestId }) {
  try {
    const sb = getAdminClient();
    await sb.from('audit_log').insert({
      user_id:     userId,
      action,
      target_id:   targetId   || null,
      target_type: targetType || null,
      metadata,
      ip:          ip         || null,
      request_id:  requestId  || null,
    });
  } catch (err) {
    // Audit failures must never kill a request
    console.error('[audit] write failed:', err?.message, { action, userId });
  }
}

module.exports = { writeAudit };
