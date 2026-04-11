'use strict';

/**
 * serve-asset.js — HTML Asset Preview Server
 *
 * Public GET endpoint that serves a generated HTML page by asset ID.
 * No authentication required — anyone with the UUID can view the preview.
 *
 * Routes:
 *   GET /.netlify/functions/serve-asset?id={assetId}
 *
 * Responses:
 *   200  — text/html — the generated landing page / banner / ad card
 *   400  — text/html — invalid or missing ID (Hebrew error page)
 *   404  — text/html — asset not found, deleted, or expired (Hebrew error page)
 *   405  — text/html — method not allowed
 *   500  — text/html — internal error page
 *
 * Security headers applied on every 200 response:
 *   X-Frame-Options: SAMEORIGIN        — allows embedding within same origin
 *   X-Content-Type-Options: nosniff    — browsers must respect Content-Type
 *   Cache-Control: public, max-age=3600
 *
 * Note: This function returns text/html — NOT JSON. It cannot use the shared
 * http.js helpers (which always return JSON). It uses its own respondHtml().
 */

const { loadAsset }              = require('./_shared/asset-storage');
const { createRequestContext }   = require('./_shared/observability');

// ── UUID validation ───────────────────────────────────────────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── HTML response helper ──────────────────────────────────────────────────────

function respondHtml(statusCode, html, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type':     'text/html; charset=UTF-8',
      'Cache-Control':    statusCode === 200
        ? 'public, max-age=3600, stale-while-revalidate=86400'
        : 'no-store',
      'X-Content-Type-Options': 'nosniff',
      // Allow embedding in same origin (for the app preview panel)
      'X-Frame-Options':  'SAMEORIGIN',
      ...extraHeaders,
    },
    body: html,
  };
}

// ── Error pages (Hebrew, minimal, self-contained) ─────────────────────────────

function errorPage(code, title, message, detail = '') {
  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${code} — ${title}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: "Rubik", "Heebo", Arial, sans-serif;
    background: #f9fafb;
    color: #111827;
    direction: rtl;
    text-align: right;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    padding: 24px;
  }
  .card {
    background: #fff;
    border: 1px solid #e5e7eb;
    border-radius: 16px;
    padding: 48px 40px;
    max-width: 480px;
    width: 100%;
    text-align: center;
    box-shadow: 0 4px 6px -1px rgba(0,0,0,.07);
  }
  .code  { font-size: 4rem; font-weight: 900; color: #1a56db; line-height: 1; }
  .title { font-size: 1.5rem; font-weight: 700; margin: 16px 0 8px; }
  .msg   { color: #6b7280; font-size: 1rem; line-height: 1.6; }
  .detail{ font-size: 0.8rem; color: #9ca3af; margin-top: 12px; font-family: monospace; }
</style>
</head>
<body>
  <div class="card">
    <div class="code">${code}</div>
    <div class="title">${title}</div>
    <p class="msg">${message}</p>
    ${detail ? `<p class="detail">${detail}</p>` : ''}
  </div>
</body>
</html>`;
}

const PAGE_400 = errorPage('400', 'בקשה לא תקינה',  'מזהה הנכס חסר או לא תקין.');
const PAGE_404 = errorPage('404', 'נכס לא נמצא',    'הנכס לא קיים, נמחק, או שתוקפו פג.');
const PAGE_405 = errorPage('405', 'שיטה לא מורשית', 'ניתן לגשת לנכס רק דרך בקשת GET.');
const PAGE_500 = errorPage('500', 'שגיאה פנימית',   'אירעה שגיאה בשרת. נסה שוב עוד מעט.');

// ─────────────────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  const context = createRequestContext(event, 'serve-asset');

  // ── Method gate ───────────────────────────────────────────────────────────
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { 'Cache-Control': 'no-store' }, body: '' };
  }
  if (event.httpMethod !== 'GET') {
    return respondHtml(405, PAGE_405);
  }

  // ── Parse and validate asset ID ───────────────────────────────────────────
  const assetId = event.queryStringParameters?.id
    || (event.path || '').split('/').pop();

  if (!assetId || !UUID_RE.test(assetId)) {
    return respondHtml(400, PAGE_400);
  }

  // ── Load asset ────────────────────────────────────────────────────────────
  let asset;
  try {
    asset = await loadAsset(assetId);
  } catch (err) {
    console.error(`[serve-asset] loadAsset error for id=${assetId}:`, err.message);
    return respondHtml(500, PAGE_500);
  }

  if (!asset) {
    return respondHtml(404, PAGE_404);
  }

  // ── Return HTML ───────────────────────────────────────────────────────────
  const extraHeaders = {
    // Expose asset metadata via response headers (no PII — just type/template)
    'X-Asset-Type':       asset.type       || '',
    'X-Asset-Template':   asset.template_id || '',
    'X-Asset-Created-At': asset.created_at  || '',
    ...(asset.expires_at ? { 'X-Asset-Expires-At': asset.expires_at } : {}),
    // Prevent browsers from caching expired assets after expiry date
    ...(asset.expires_at ? { 'Expires': new Date(asset.expires_at).toUTCString() } : {}),
  };

  return respondHtml(200, asset.html, extraHeaders);
};
