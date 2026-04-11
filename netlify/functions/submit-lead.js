'use strict';

/**
 * submit-lead.js — Lead Capture Endpoint
 *
 * Public POST endpoint. Called by landing page forms when a visitor submits.
 * No user authentication required — the asset_id identifies which user owns the lead.
 *
 * Routes:
 *   POST /.netlify/functions/submit-lead
 *
 * Body (application/x-www-form-urlencoded OR application/json):
 *   asset_id   {string}  — UUID of the landing page (required)
 *   name       {string?}
 *   phone      {string?}
 *   email      {string?}
 *   bot-field  {string}  — honeypot, must be empty
 *
 * Responses:
 *   200  — { success: true, lead_id }
 *   400  — missing asset_id or no contact data
 *   404  — asset not found or deleted
 *   405  — method not allowed
 *   429  — rate limited
 *   500  — internal error
 *
 * Security:
 *   - Honeypot field blocks bots
 *   - asset_id validated against generated_assets (must be active)
 *   - user_id resolved server-side — never trusted from client
 *   - All text fields sanitised (length cap + XSS strip)
 *   - Rate limited by asset_id (max 30 submissions / 10 min window)
 *
 * Required SQL migration (run once in Supabase):
 *   See bottom of this file.
 */

const { getAdminClient }        = require('./_shared/supabase');
const { createRequestContext }  = require('./_shared/observability');

// ── UUID validation ───────────────────────────────────────────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Field size caps ───────────────────────────────────────────────────────────
const MAX_TEXT_LEN = 200;
const MAX_EMAIL_LEN = 254; // RFC 5321

// ── Rate limiting (in-memory, resets per cold start — good enough for edge abuse) ──
const rateLimitMap = new Map(); // key: asset_id → { count, windowStart }
const RATE_LIMIT_MAX    = 30;
const RATE_LIMIT_WINDOW = 10 * 60 * 1000; // 10 minutes in ms

function isRateLimited(assetId) {
  const now   = Date.now();
  const entry = rateLimitMap.get(assetId) || { count: 0, windowStart: now };

  if (now - entry.windowStart > RATE_LIMIT_WINDOW) {
    // Window expired — reset
    rateLimitMap.set(assetId, { count: 1, windowStart: now });
    return false;
  }

  if (entry.count >= RATE_LIMIT_MAX) return true;

  entry.count++;
  rateLimitMap.set(assetId, entry);
  return false;
}

// ── Sanitise a single text field ──────────────────────────────────────────────
function sanitise(value, maxLen = MAX_TEXT_LEN) {
  if (value == null) return null;
  const s = String(value)
    .trim()
    .slice(0, maxLen)
    // Strip HTML tags
    .replace(/<[^>]*>/g, '')
    // Strip common XSS patterns
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '');
  return s.length > 0 ? s : null;
}

// ── Parse body — handles JSON and form-encoded ────────────────────────────────
function parseBody(event) {
  const ct = (event.headers['content-type'] || '').toLowerCase();
  const raw = event.body || '';
  const body = event.isBase64Encoded ? Buffer.from(raw, 'base64').toString('utf8') : raw;

  if (ct.includes('application/json')) {
    try { return JSON.parse(body); } catch (_) { return {}; }
  }

  // application/x-www-form-urlencoded (default HTML form)
  const params = new URLSearchParams(body);
  const out = {};
  for (const [k, v] of params.entries()) out[k] = v;
  return out;
}

// ── Response helpers ──────────────────────────────────────────────────────────
function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type':              'application/json; charset=UTF-8',
      'Cache-Control':             'no-store',
      'X-Content-Type-Options':    'nosniff',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(body),
  };
}

function htmlRedirect(location) {
  return {
    statusCode: 303,
    headers: {
      Location:     location,
      'Cache-Control': 'no-store',
    },
    body: '',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  createRequestContext(event, 'submit-lead'); // sets up logging context

  // ── CORS pre-flight ───────────────────────────────────────────────────────
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin':  '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Cache-Control': 'no-store',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  // ── Parse ─────────────────────────────────────────────────────────────────
  const raw = parseBody(event);

  // ── Honeypot — silent bot discard ─────────────────────────────────────────
  if (raw['bot-field'] || raw['bot_field']) {
    // Return 200 so bots think they succeeded
    return json(200, { success: true });
  }

  // ── Validate asset_id ──────────────────────────────────────────────────────
  const assetId = sanitise(raw['asset_id'] || raw['assetId'], 36);
  if (!assetId || !UUID_RE.test(assetId)) {
    return json(400, { error: 'asset_id חסר או לא תקין' });
  }

  // ── Validate at least one contact field ───────────────────────────────────
  const name  = sanitise(raw['name']  || raw['שם מלא']);
  const phone = sanitise(raw['phone'] || raw['טלפון'] || raw['מספר טלפון']);
  const email = sanitise(raw['email'] || raw['מייל'], MAX_EMAIL_LEN);

  if (!name && !phone && !email) {
    return json(400, { error: 'נדרש לפחות שדה קשר אחד (שם, טלפון, או מייל)' });
  }

  // ── Rate limit ─────────────────────────────────────────────────────────────
  if (isRateLimited(assetId)) {
    return json(429, { error: 'יותר מדי בקשות — נסה שוב עוד מעט' });
  }

  const supabase = getAdminClient();

  // ── Resolve user_id from asset_id ─────────────────────────────────────────
  const { data: asset, error: assetError } = await supabase
    .from('generated_assets')
    .select('user_id, status')
    .eq('id', assetId)
    .eq('status', 'active')
    .maybeSingle();

  if (assetError) {
    console.error('[submit-lead] asset lookup error:', assetError.message);
    return json(500, { error: 'שגיאת שרת — נסה שוב' });
  }

  if (!asset) {
    return json(404, { error: 'הדף לא נמצא' });
  }

  const userId = asset.user_id;

  // ── Build metadata from remaining fields ──────────────────────────────────
  const KNOWN_FIELDS = new Set(['asset_id', 'assetId', 'name', 'phone', 'email',
    'שם מלא', 'טלפון', 'מספר טלפון', 'מייל', 'bot-field', 'bot_field', 'form-name']);
  const extraFields = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!KNOWN_FIELDS.has(k) && v != null) {
      extraFields[sanitise(k, 50)] = sanitise(String(v));
    }
  }

  const metadata = {
    source_url:  event.headers['referer'] || null,
    user_agent:  (event.headers['user-agent'] || '').slice(0, 200),
    submitted_at: new Date().toISOString(),
    ...(Object.keys(extraFields).length > 0 ? { extra_fields: extraFields } : {}),
  };

  // ── Insert lead ────────────────────────────────────────────────────────────
  const { data: lead, error: insertError } = await supabase
    .from('leads')
    .insert({
      user_id:  userId,
      asset_id: assetId,
      name:     name  || null,
      phone:    phone || null,
      email:    email || null,
      metadata,
    })
    .select('id')
    .single();

  if (insertError) {
    console.error('[submit-lead] insert error:', insertError.message);
    return json(500, { error: 'שגיאת שמירה — נסה שוב' });
  }

  console.log(`[submit-lead] lead saved: ${lead.id} → user ${userId} via asset ${assetId}`);

  // ── Return success ─────────────────────────────────────────────────────────
  // If request came from a browser form (not fetch/JSON), redirect to thank-you
  const acceptsHtml = (event.headers['accept'] || '').includes('text/html');
  const isJsonRequest = (event.headers['content-type'] || '').includes('application/json');

  if (acceptsHtml && !isJsonRequest) {
    // Redirect to same page with ?submitted=1 — page can show thank-you message
    const referer  = event.headers['referer'] || '/';
    const redirect = referer.includes('?') ? `${referer}&submitted=1` : `${referer}?submitted=1`;
    return htmlRedirect(redirect);
  }

  return json(200, { success: true, lead_id: lead.id });
};

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * REQUIRED SQL — run once in Supabase SQL editor:
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * CREATE TABLE IF NOT EXISTS leads (
 *   id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
 *   user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 *   asset_id   uuid        NOT NULL REFERENCES generated_assets(id) ON DELETE CASCADE,
 *   name       text,
 *   phone      text,
 *   email      text,
 *   metadata   jsonb,
 *   status     text        NOT NULL DEFAULT 'new',   -- 'new' | 'contacted' | 'converted' | 'lost'
 *   created_at timestamptz NOT NULL DEFAULT now()
 * );
 *
 * -- Indexes for fast retrieval
 * CREATE INDEX IF NOT EXISTS leads_user_id_idx    ON leads (user_id, created_at DESC);
 * CREATE INDEX IF NOT EXISTS leads_asset_id_idx   ON leads (asset_id, created_at DESC);
 * CREATE INDEX IF NOT EXISTS leads_status_idx     ON leads (user_id, status);
 *
 * -- Enable RLS (service-role bypasses it; future client-side access is locked per user)
 * ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
 *
 * -- RLS policy: users can only see their own leads
 * CREATE POLICY "users_own_leads" ON leads
 *   FOR ALL TO authenticated
 *   USING (user_id = auth.uid());
 * ─────────────────────────────────────────────────────────────────────────────
 */
