'use strict';

/**
 * asset-storage.js — Generated Asset Storage Layer
 *
 * Saves HTML assets to Supabase Storage and records metadata in the DB.
 * The serve-asset.js function reads from here to serve preview pages.
 *
 * Storage layout (Supabase bucket: "generated-assets"):
 *   {userId}/{assetId}/index.html     ← self-contained HTML (embedded CSS)
 *   {userId}/{assetId}/manifest.json  ← metadata snapshot
 *
 * DB table: generated_assets
 *   id            uuid PK
 *   user_id       uuid NOT NULL
 *   type          text               — 'landing_page_html' | 'banner_html' | 'ad_html'
 *   template_id   text
 *   title         text
 *   storage_path  text NOT NULL      — '{userId}/{assetId}'
 *   status        text DEFAULT 'active'  — 'active' | 'deleted'
 *   metadata      jsonb
 *   created_at    timestamptz DEFAULT now()
 *   expires_at    timestamptz
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * REQUIRED: Run this migration in Supabase SQL editor before first use:
 *
 *   -- 1. Create table
 *   CREATE TABLE IF NOT EXISTS generated_assets (
 *     id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 *     user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 *     type         text NOT NULL,
 *     template_id  text,
 *     title        text,
 *     storage_path text NOT NULL,
 *     status       text NOT NULL DEFAULT 'active',
 *     metadata     jsonb,
 *     created_at   timestamptz NOT NULL DEFAULT now(),
 *     expires_at   timestamptz
 *   );
 *   CREATE INDEX IF NOT EXISTS generated_assets_user_idx ON generated_assets (user_id, status, created_at DESC);
 *   CREATE INDEX IF NOT EXISTS generated_assets_id_status ON generated_assets (id, status);
 *
 *   -- 2. Enable RLS (service-role bypasses it, but enables row-level access control)
 *   ALTER TABLE generated_assets ENABLE ROW LEVEL SECURITY;
 *
 *   -- 3. Create Storage bucket (once, via Supabase dashboard or API)
 *   --    Bucket name: generated-assets
 *   --    Public: false (files served via serve-asset function, not directly)
 * ──────────────────────────────────────────────────────────────────────────────
 */

const crypto              = require('crypto');
const { getAdminClient }  = require('./supabase');
const { AppError }        = require('./errors');

// ── Constants ─────────────────────────────────────────────────────────────────

const BUCKET           = 'generated-assets';
const DEFAULT_TTL_DAYS = 30;              // preview links expire after 30 days
const UUID_RE          = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_HTML_BYTES   = 8 * 1024 * 1024; // 8MB safety cap — Netlify body limit is 10MB

// ── Internal helpers ──────────────────────────────────────────────────────────

function newAssetId() {
  // crypto.randomUUID() available in Node 18+
  return crypto.randomUUID();
}

function storagePath(userId, assetId) {
  return `${userId}/${assetId}`;
}

function expiresAt(ttlDays = DEFAULT_TTL_DAYS) {
  const d = new Date();
  d.setDate(d.getDate() + ttlDays);
  return d.toISOString();
}

async function uploadToStorage(supabase, path, content, contentType) {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, {
      contentType,
      upsert: false,
      duplex: 'half',   // required for Supabase JS v2 in Node.js environments
    });

  if (error) {
    throw new AppError({
      code:        'STORAGE_UPLOAD_FAILED',
      userMessage: 'שמירת הנכס נכשלה',
      devMessage:  `Storage upload failed for path "${path}": ${error.message}`,
      status:      500,
    });
  }
}

async function removeFromStorage(supabase, paths) {
  const { error } = await supabase.storage.from(BUCKET).remove(paths);
  if (error) {
    // Non-fatal — log but don't throw (DB record deletion still happens)
    console.warn(`[asset-storage] Storage removal failed for ${paths.join(', ')}: ${error.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// saveAsset — persist a generated HTML asset
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Saves the HTML output of composeHTML() to Supabase Storage and records
 * the asset metadata in the generated_assets table.
 *
 * The stored HTML is the ORIGINAL composed output with embedded CSS —
 * self-contained for preview. The ZIP export (for deployment) is handled
 * separately by the export layer.
 *
 * @param {object} params
 *   userId         {string}  — authenticated user UUID
 *   html           {string}  — output of composeHTML().html
 *   composeResult  {object}  — full composeHTML() result (for metadata)
 *   title          {string?} — optional user-visible label
 *   ttlDays        {number?} — days until preview link expires (default: 30)
 * @returns {SavedAsset}
 *   assetId    {string}  — UUID of the saved asset
 *   previewUrl {string}  — URL to serve-asset function (?id=...)
 *   expiresAt  {string}  — ISO date string
 *   storagePath{string}  — internal Storage path prefix
 */
async function saveAsset({ userId, html, composeResult = {}, title = null, ttlDays = DEFAULT_TTL_DAYS, _pregenId = null }) {
  if (!userId)             throw new AppError({ code: 'MISSING_PARAM', userMessage: 'חסר userId', devMessage: 'saveAsset: userId is required', status: 400 });
  if (typeof html !== 'string' || html.length === 0)
    throw new AppError({ code: 'MISSING_PARAM', userMessage: 'חסר HTML', devMessage: 'saveAsset: html must be a non-empty string', status: 400 });
  if (html.length > MAX_HTML_BYTES)
    throw new AppError({ code: 'ASSET_TOO_LARGE', userMessage: 'הנכס גדול מדי', devMessage: `saveAsset: html exceeds ${MAX_HTML_BYTES} bytes`, status: 413 });

  const supabase = getAdminClient();
  // Use caller-supplied UUID when available (allows asset_id to be injected into HTML before saving)
  const assetId  = (_pregenId && UUID_RE.test(_pregenId)) ? _pregenId : newAssetId();
  const basePath = storagePath(userId, assetId);
  const expiry   = expiresAt(ttlDays);

  // ── Build metadata snapshot ───────────────────────────────────────────────
  const metadata = {
    type:              composeResult.type             || 'landing_page_html',
    template_id:       composeResult.template_id      || null,
    sections_rendered: composeResult.sections_rendered || null,
    warnings:          composeResult.warnings         || [],
    image_slots:       (html.match(/data-image-prompt/g) || []).length,
    netlify_forms:     html.includes('data-netlify="true"'),
    html_size_bytes:   Buffer.byteLength(html, 'utf8'),
    saved_at:          new Date().toISOString(),
  };

  // ── Upload files to Storage ───────────────────────────────────────────────
  await uploadToStorage(supabase, `${basePath}/index.html`,    html,                              'text/html; charset=UTF-8');
  await uploadToStorage(supabase, `${basePath}/manifest.json`, JSON.stringify(metadata, null, 2), 'application/json; charset=UTF-8');

  // ── Insert DB row ─────────────────────────────────────────────────────────
  const { error: dbError } = await supabase
    .from('generated_assets')
    .insert({
      id:           assetId,
      user_id:      userId,
      type:         metadata.type,
      template_id:  metadata.template_id,
      title:        title || null,
      storage_path: basePath,
      status:       'active',
      metadata,
      expires_at:   expiry,
    });

  if (dbError) {
    // Best-effort cleanup: remove Storage files we just uploaded
    await removeFromStorage(supabase, [
      `${basePath}/index.html`,
      `${basePath}/manifest.json`,
    ]);
    throw new AppError({
      code:        'DB_WRITE_FAILED',
      userMessage: 'שמירת הנכס נכשלה',
      devMessage:  `generated_assets insert failed: ${dbError.message}`,
      status:      500,
    });
  }

  return {
    assetId,
    previewUrl:  `/.netlify/functions/serve-asset?id=${assetId}`,
    storagePath: basePath,
    expiresAt:   expiry,
    metadata,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// loadAsset — retrieve a saved asset for serving or re-use
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Loads a saved asset by ID. Used by serve-asset.js to serve the HTML.
 * Does NOT require userId — preview URLs are public (any UUID holder can view).
 *
 * Returns null if: asset not found, deleted, or expired.
 *
 * @param {string} assetId — UUID
 * @returns {LoadedAsset | null}
 *   html        {string}
 *   type        {string}
 *   template_id {string|null}
 *   title       {string|null}
 *   metadata    {object}
 *   created_at  {string}
 *   expires_at  {string|null}
 */
async function loadAsset(assetId) {
  if (!assetId || !UUID_RE.test(assetId)) return null;

  const supabase = getAdminClient();

  // ── Fetch DB row ──────────────────────────────────────────────────────────
  const { data: row, error: dbError } = await supabase
    .from('generated_assets')
    .select('id, user_id, type, template_id, title, storage_path, metadata, created_at, expires_at, status')
    .eq('id', assetId)
    .eq('status', 'active')
    .maybeSingle();

  if (dbError || !row) return null;

  // ── Check expiry ──────────────────────────────────────────────────────────
  if (row.expires_at && new Date(row.expires_at) < new Date()) return null;

  // ── Download HTML from Storage ────────────────────────────────────────────
  const { data: blob, error: downloadError } = await supabase.storage
    .from(BUCKET)
    .download(`${row.storage_path}/index.html`);

  if (downloadError || !blob) {
    console.warn(`[asset-storage] Storage download failed for asset ${assetId}: ${downloadError?.message}`);
    return null;
  }

  // Blob.text() available in Node 18+
  const html = await blob.text();
  if (!html) return null;

  return {
    html,
    type:        row.type,
    template_id: row.template_id,
    title:       row.title,
    metadata:    row.metadata || {},
    created_at:  row.created_at,
    expires_at:  row.expires_at,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// listUserAssets — list a user's saved assets (newest first)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {string} userId
 * @param {object} options
 *   type   {string?} — filter by asset type
 *   limit  {number}  — max results (default: 20)
 *   offset {number}  — pagination offset (default: 0)
 * @returns {AssetListItem[]}
 */
async function listUserAssets(userId, { type = null, limit = 20, offset = 0 } = {}) {
  if (!userId) throw new AppError({ code: 'MISSING_PARAM', devMessage: 'listUserAssets: userId required', status: 400 });

  const supabase = getAdminClient();
  let query = supabase
    .from('generated_assets')
    .select('id, type, template_id, title, metadata, created_at, expires_at')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (type) query = query.eq('type', type);

  const { data, error } = await query;
  if (error) throw new AppError({ code: 'DB_READ_FAILED', devMessage: error.message, status: 500 });

  return (data || []).map((row) => ({
    assetId:    row.id,
    type:       row.type,
    templateId: row.template_id,
    title:      row.title,
    metadata:   row.metadata || {},
    createdAt:  row.created_at,
    expiresAt:  row.expires_at,
    previewUrl: `/.netlify/functions/serve-asset?id=${row.id}`,
    isExpired:  row.expires_at ? new Date(row.expires_at) < new Date() : false,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// deleteAsset — soft-delete an asset (marks as deleted, removes Storage files)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {string} assetId
 * @param {string} userId — enforced ownership check
 */
async function deleteAsset(assetId, userId) {
  if (!assetId || !UUID_RE.test(assetId)) throw new AppError({ code: 'INVALID_ID', devMessage: 'Invalid assetId', status: 400 });
  if (!userId)  throw new AppError({ code: 'MISSING_PARAM', devMessage: 'userId required', status: 400 });

  const supabase = getAdminClient();

  // Fetch to verify ownership + get storage_path
  const { data: row, error: fetchError } = await supabase
    .from('generated_assets')
    .select('id, user_id, storage_path')
    .eq('id', assetId)
    .eq('user_id', userId)     // ownership check
    .eq('status', 'active')
    .maybeSingle();

  if (fetchError) throw new AppError({ code: 'DB_READ_FAILED', devMessage: fetchError.message, status: 500 });
  if (!row) throw new AppError({ code: 'NOT_FOUND', userMessage: 'הנכס לא נמצא', devMessage: `Asset ${assetId} not found or not owned by user ${userId}`, status: 404 });

  // Mark as deleted in DB
  const { error: updateError } = await supabase
    .from('generated_assets')
    .update({ status: 'deleted' })
    .eq('id', assetId);

  if (updateError) throw new AppError({ code: 'DB_WRITE_FAILED', devMessage: updateError.message, status: 500 });

  // Remove Storage files (non-fatal)
  await removeFromStorage(supabase, [
    `${row.storage_path}/index.html`,
    `${row.storage_path}/manifest.json`,
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// refreshAssetExpiry — extend a preview link's expiry
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {string} assetId
 * @param {string} userId
 * @param {number} ttlDays — additional days from now (default: 30)
 */
async function refreshAssetExpiry(assetId, userId, ttlDays = DEFAULT_TTL_DAYS) {
  const supabase = getAdminClient();
  const newExpiry = expiresAt(ttlDays);

  const { error } = await supabase
    .from('generated_assets')
    .update({ expires_at: newExpiry })
    .eq('id', assetId)
    .eq('user_id', userId)
    .eq('status', 'active');

  if (error) throw new AppError({ code: 'DB_WRITE_FAILED', devMessage: error.message, status: 500 });
  return { assetId, expiresAt: newExpiry };
}

// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  saveAsset,
  loadAsset,
  listUserAssets,
  deleteAsset,
  refreshAssetExpiry,
  BUCKET,
};
