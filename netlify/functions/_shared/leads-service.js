'use strict';

/**
 * leads-service.js — Lead Management Service
 *
 * Server-side only. All functions validate ownership via user_id before
 * touching any rows — a user can only access their own leads.
 *
 * Used by:
 *   - API endpoints (get-leads, update-lead, delete-lead)
 *   - Future: dashboard export, CRM sync
 *
 * DB table: leads
 *   id         uuid PK
 *   user_id    uuid NOT NULL → auth.users
 *   asset_id   uuid NOT NULL → generated_assets
 *   name       text
 *   phone      text
 *   email      text
 *   metadata   jsonb
 *   status     text  DEFAULT 'new'  ('new'|'contacted'|'converted'|'lost')
 *   created_at timestamptz
 */

const { getAdminClient } = require('./supabase');
const { AppError }       = require('./errors');

// ── Constants ─────────────────────────────────────────────────────────────────

const UUID_RE       = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_STATUSES = new Set(['new', 'contacted', 'converted', 'lost']);
const DEFAULT_LIMIT  = 50;
const MAX_LIMIT      = 200;

// ── Internal helpers ──────────────────────────────────────────────────────────

function assertUUID(val, name) {
  if (!val || !UUID_RE.test(val)) {
    throw new AppError({ code: 'INVALID_ID', devMessage: `${name} must be a valid UUID`, status: 400 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// getLeadsByUser — list all leads for a user (newest first)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {string} userId
 * @param {object} options
 *   assetId  {string?} — filter to a specific landing page
 *   status   {string?} — filter by status
 *   limit    {number}  — max rows (default 50, max 200)
 *   offset   {number}  — pagination offset
 * @returns {Lead[]}
 */
async function getLeadsByUser(userId, { assetId = null, status = null, limit = DEFAULT_LIMIT, offset = 0 } = {}) {
  assertUUID(userId, 'userId');

  const safeLimit = Math.min(Math.max(1, Number(limit) || DEFAULT_LIMIT), MAX_LIMIT);

  const supabase = getAdminClient();
  let query = supabase
    .from('leads')
    .select('id, asset_id, name, phone, email, status, metadata, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + safeLimit - 1);

  if (assetId)           query = query.eq('asset_id', assetId);
  if (status)            query = query.eq('status', status);

  const { data, error } = await query;
  if (error) throw new AppError({ code: 'DB_READ_FAILED', devMessage: error.message, status: 500 });

  return (data || []).map(_formatLead);
}

// ─────────────────────────────────────────────────────────────────────────────
// getLeadsByAsset — list leads for a single asset (verifies ownership)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {string} assetId
 * @param {string} userId   — ownership check
 * @param {object} options  — limit, offset
 * @returns {Lead[]}
 */
async function getLeadsByAsset(assetId, userId, { limit = DEFAULT_LIMIT, offset = 0 } = {}) {
  assertUUID(assetId, 'assetId');
  assertUUID(userId, 'userId');

  // Verify the asset belongs to this user before returning its leads
  const supabase = getAdminClient();
  const { data: asset, error: assetErr } = await supabase
    .from('generated_assets')
    .select('id')
    .eq('id', assetId)
    .eq('user_id', userId)
    .maybeSingle();

  if (assetErr) throw new AppError({ code: 'DB_READ_FAILED', devMessage: assetErr.message, status: 500 });
  if (!asset)   throw new AppError({ code: 'NOT_FOUND', userMessage: 'הדף לא נמצא', devMessage: `Asset ${assetId} not found for user ${userId}`, status: 404 });

  return getLeadsByUser(userId, { assetId, limit, offset });
}

// ─────────────────────────────────────────────────────────────────────────────
// getLeadById — single lead (verifies ownership)
// ─────────────────────────────────────────────────────────────────────────────

async function getLeadById(leadId, userId) {
  assertUUID(leadId, 'leadId');
  assertUUID(userId, 'userId');

  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from('leads')
    .select('id, asset_id, name, phone, email, status, metadata, created_at')
    .eq('id', leadId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw new AppError({ code: 'DB_READ_FAILED', devMessage: error.message, status: 500 });
  if (!data)  throw new AppError({ code: 'NOT_FOUND', userMessage: 'ליד לא נמצא', devMessage: `Lead ${leadId} not found`, status: 404 });

  return _formatLead(data);
}

// ─────────────────────────────────────────────────────────────────────────────
// updateLeadStatus — change lead status (validates ownership)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {string} leadId
 * @param {string} userId
 * @param {string} status — 'new' | 'contacted' | 'converted' | 'lost'
 * @returns {{ id, status }}
 */
async function updateLeadStatus(leadId, userId, status) {
  assertUUID(leadId, 'leadId');
  assertUUID(userId, 'userId');

  if (!VALID_STATUSES.has(status)) {
    throw new AppError({
      code: 'INVALID_STATUS',
      userMessage: `סטטוס לא תקין. ערכים מותרים: ${[...VALID_STATUSES].join(', ')}`,
      devMessage:  `Invalid status "${status}"`,
      status: 400,
    });
  }

  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from('leads')
    .update({ status })
    .eq('id', leadId)
    .eq('user_id', userId)    // ownership enforced in query
    .select('id, status')
    .maybeSingle();

  if (error) throw new AppError({ code: 'DB_WRITE_FAILED', devMessage: error.message, status: 500 });
  if (!data)  throw new AppError({ code: 'NOT_FOUND', userMessage: 'ליד לא נמצא', devMessage: `Lead ${leadId} not found for user ${userId}`, status: 404 });

  return { id: data.id, status: data.status };
}

// ─────────────────────────────────────────────────────────────────────────────
// deleteLead — hard delete (validates ownership)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {string} leadId
 * @param {string} userId
 */
async function deleteLead(leadId, userId) {
  assertUUID(leadId, 'leadId');
  assertUUID(userId, 'userId');

  const supabase = getAdminClient();

  // Fetch first to confirm ownership and existence
  const { data: existing, error: fetchErr } = await supabase
    .from('leads')
    .select('id')
    .eq('id', leadId)
    .eq('user_id', userId)
    .maybeSingle();

  if (fetchErr) throw new AppError({ code: 'DB_READ_FAILED', devMessage: fetchErr.message, status: 500 });
  if (!existing) throw new AppError({ code: 'NOT_FOUND', userMessage: 'ליד לא נמצא', devMessage: `Lead ${leadId} not found`, status: 404 });

  const { error: deleteErr } = await supabase
    .from('leads')
    .delete()
    .eq('id', leadId)
    .eq('user_id', userId);

  if (deleteErr) throw new AppError({ code: 'DB_WRITE_FAILED', devMessage: deleteErr.message, status: 500 });
}

// ─────────────────────────────────────────────────────────────────────────────
// exportLeadsCSV — generate CSV string for download
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {string} userId
 * @param {string?} assetId — optional filter
 * @returns {string} — CSV text (UTF-8 with BOM for Excel Hebrew support)
 */
async function exportLeadsCSV(userId, assetId = null) {
  const leads = await getLeadsByUser(userId, { assetId, limit: MAX_LIMIT });

  const BOM     = '\uFEFF';
  const HEADERS = ['מזהה', 'שם', 'טלפון', 'מייל', 'סטטוס', 'דף מקור', 'תאריך'];

  const rows = leads.map((l) => [
    l.id,
    _csvCell(l.name),
    _csvCell(l.phone),
    _csvCell(l.email),
    _csvCell(l.status),
    _csvCell(l.asset_id),
    _csvCell(l.created_at ? new Date(l.created_at).toLocaleDateString('he-IL') : ''),
  ]);

  const lines = [HEADERS, ...rows].map((row) => row.join(',')).join('\r\n');
  return BOM + lines;
}

// ── Internal formatters ───────────────────────────────────────────────────────

function _formatLead(row) {
  return {
    id:         row.id,
    asset_id:   row.asset_id,
    name:       row.name   || null,
    phone:      row.phone  || null,
    email:      row.email  || null,
    status:     row.status || 'new',
    metadata:   row.metadata || {},
    created_at: row.created_at,
  };
}

function _csvCell(val) {
  if (val == null || val === '') return '';
  const s = String(val);
  // Escape double quotes and wrap in quotes if contains comma/newline/quote
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  getLeadsByUser,
  getLeadsByAsset,
  getLeadById,
  updateLeadStatus,
  deleteLead,
  exportLeadsCSV,
};
