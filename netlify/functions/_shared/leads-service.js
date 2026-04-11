'use strict';

/**
 * leads-service.js — Lead Management Service
 *
 * Server-side only. Ownership is always validated via user_id.
 * A user can only ever access leads where leads.user_id = their id.
 *
 * Statuses: 'new' | 'contacted' | 'qualified' | 'closed' | 'archived'
 */

const { getAdminClient } = require('./supabase');
const { AppError }       = require('./errors');

// ── Constants ─────────────────────────────────────────────────────────────────

const UUID_RE        = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_STATUSES = new Set(['new', 'contacted', 'qualified', 'closed', 'archived']);
const DEFAULT_LIMIT  = 50;
const MAX_LIMIT      = 200;

function assertUUID(val, name) {
  if (!val || !UUID_RE.test(val)) {
    throw new AppError({ code: 'INVALID_ID', devMessage: `${name} must be a valid UUID`, status: 400 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// getLeadsByUser — list leads with full filter / sort / pagination support
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {string} userId
 * @param {object} options
 *   assetId   {string?}  — filter to a specific asset
 *   status    {string?}  — filter by status
 *   search    {string?}  — partial match on name / phone / email
 *   dateFrom  {string?}  — ISO date string, inclusive lower bound
 *   dateTo    {string?}  — ISO date string, inclusive upper bound
 *   sort      {string}   — 'newest' (default) | 'oldest'
 *   limit     {number}   — max rows, default 50, max 200
 *   offset    {number}   — pagination offset
 * @returns {{ leads: Lead[], total: number }}
 */
async function getLeadsByUser(userId, {
  assetId  = null,
  status   = null,
  search   = null,
  dateFrom = null,
  dateTo   = null,
  sort     = 'newest',
  limit    = DEFAULT_LIMIT,
  offset   = 0,
} = {}) {
  assertUUID(userId, 'userId');

  const safeLimit = Math.min(Math.max(1, Number(limit) || DEFAULT_LIMIT), MAX_LIMIT);
  const ascending = sort === 'oldest';

  const supabase = getAdminClient();

  // Build base query — join generated_assets to get asset title
  let query = supabase
    .from('leads')
    .select('id, asset_id, name, phone, email, status, metadata, created_at, generated_assets(title, type)', { count: 'exact' })
    .eq('user_id', userId)
    .order('created_at', { ascending })
    .range(offset, offset + safeLimit - 1);

  if (assetId) query = query.eq('asset_id', assetId);
  if (status)  query = query.eq('status', status);
  if (dateFrom) query = query.gte('created_at', dateFrom);
  if (dateTo)   query = query.lte('created_at', dateTo + 'T23:59:59Z');

  // Search: Supabase doesn't support multi-column OR ilike in one call easily,
  // so we use the ilike across columns with or()
  if (search && search.trim().length > 0) {
    const term = search.trim().replace(/[%_]/g, '\\$&'); // escape wildcards
    query = query.or(`name.ilike.%${term}%,phone.ilike.%${term}%,email.ilike.%${term}%`);
  }

  const { data, error, count } = await query;
  if (error) throw new AppError({ code: 'DB_READ_FAILED', devMessage: error.message, status: 500 });

  return {
    leads: (data || []).map(_formatLead),
    total: count || 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// getLeadSummary — counts per status for summary cards
// ─────────────────────────────────────────────────────────────────────────────

async function getLeadSummary(userId) {
  assertUUID(userId, 'userId');

  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from('leads')
    .select('status')
    .eq('user_id', userId);

  if (error) throw new AppError({ code: 'DB_READ_FAILED', devMessage: error.message, status: 500 });

  const counts = { total: 0, new: 0, contacted: 0, qualified: 0, closed: 0, archived: 0 };
  for (const row of (data || [])) {
    counts.total++;
    if (counts[row.status] !== undefined) counts[row.status]++;
  }
  return counts;
}

// ─────────────────────────────────────────────────────────────────────────────
// getUserAssets — list assets that have at least one lead (for filter dropdown)
// ─────────────────────────────────────────────────────────────────────────────

async function getAssetsWithLeads(userId) {
  assertUUID(userId, 'userId');

  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from('leads')
    .select('asset_id, generated_assets(id, title, type)')
    .eq('user_id', userId)
    .not('asset_id', 'is', null);

  if (error) throw new AppError({ code: 'DB_READ_FAILED', devMessage: error.message, status: 500 });

  // Deduplicate by asset_id
  const seen = new Map();
  for (const row of (data || [])) {
    if (!seen.has(row.asset_id)) {
      seen.set(row.asset_id, {
        assetId: row.asset_id,
        title:   row.generated_assets?.title || null,
        type:    row.generated_assets?.type  || null,
      });
    }
  }
  return [...seen.values()];
}

// ─────────────────────────────────────────────────────────────────────────────
// getLeadById — single lead with ownership check
// ─────────────────────────────────────────────────────────────────────────────

async function getLeadById(leadId, userId) {
  assertUUID(leadId, 'leadId');
  assertUUID(userId, 'userId');

  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from('leads')
    .select('id, asset_id, name, phone, email, status, metadata, created_at, generated_assets(id, title, type)')
    .eq('id', leadId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw new AppError({ code: 'DB_READ_FAILED', devMessage: error.message, status: 500 });
  if (!data)  throw new AppError({ code: 'NOT_FOUND', userMessage: 'ליד לא נמצא', devMessage: `Lead ${leadId} not found`, status: 404 });

  return _formatLead(data);
}

// ─────────────────────────────────────────────────────────────────────────────
// updateLeadStatus — validated ownership update
// ─────────────────────────────────────────────────────────────────────────────

async function updateLeadStatus(leadId, userId, status) {
  assertUUID(leadId, 'leadId');
  assertUUID(userId, 'userId');

  if (!VALID_STATUSES.has(status)) {
    throw new AppError({
      code:        'INVALID_STATUS',
      userMessage: `סטטוס לא תקין. מותר: ${[...VALID_STATUSES].join(', ')}`,
      devMessage:  `Invalid status "${status}"`,
      status: 400,
    });
  }

  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from('leads')
    .update({ status })
    .eq('id', leadId)
    .eq('user_id', userId)
    .select('id, status')
    .maybeSingle();

  if (error) throw new AppError({ code: 'DB_WRITE_FAILED', devMessage: error.message, status: 500 });
  if (!data)  throw new AppError({ code: 'NOT_FOUND', userMessage: 'ליד לא נמצא', devMessage: `Lead ${leadId} not found or not owned`, status: 404 });

  return { id: data.id, status: data.status };
}

// ─────────────────────────────────────────────────────────────────────────────
// deleteLead — hard delete with ownership check
// ─────────────────────────────────────────────────────────────────────────────

async function deleteLead(leadId, userId) {
  assertUUID(leadId, 'leadId');
  assertUUID(userId, 'userId');

  const supabase = getAdminClient();

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
// exportLeadsCSV — generate UTF-8 CSV with BOM for Hebrew Excel support
// ─────────────────────────────────────────────────────────────────────────────

async function exportLeadsCSV(userId, filters = {}) {
  assertUUID(userId, 'userId');

  const { leads } = await getLeadsByUser(userId, { ...filters, limit: MAX_LIMIT, offset: 0 });

  const BOM     = '\uFEFF';
  const HEADERS = ['שם', 'טלפון', 'מייל', 'סטטוס', 'שם דף', 'תאריך'];

  const rows = leads.map((l) => [
    _csvCell(l.name),
    _csvCell(l.phone),
    _csvCell(l.email),
    _csvCell(_statusLabel(l.status)),
    _csvCell(l.asset_title || l.asset_id),
    _csvCell(l.created_at ? new Date(l.created_at).toLocaleDateString('he-IL') : ''),
  ]);

  const lines = [HEADERS, ...rows].map((row) => row.join(',')).join('\r\n');
  return BOM + lines;
}

// ── Internal formatters ───────────────────────────────────────────────────────

function _formatLead(row) {
  return {
    id:          row.id,
    asset_id:    row.asset_id,
    asset_title: row.generated_assets?.title || null,
    asset_type:  row.generated_assets?.type  || null,
    name:        row.name   || null,
    phone:       row.phone  || null,
    email:       row.email  || null,
    status:      row.status || 'new',
    metadata:    row.metadata || {},
    created_at:  row.created_at,
  };
}

function _statusLabel(status) {
  return { new: 'חדש', contacted: 'ביצירת קשר', qualified: 'מוסמך', closed: 'סגור', archived: 'בארכיון' }[status] || status;
}

function _csvCell(val) {
  if (val == null || val === '') return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  getLeadsByUser,
  getLeadSummary,
  getAssetsWithLeads,
  getLeadById,
  updateLeadStatus,
  deleteLead,
  exportLeadsCSV,
  VALID_STATUSES,
};
