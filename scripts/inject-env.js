/**
 * inject-env.js — Build step: replace %%VAR%% placeholders in index.html
 * with real Netlify environment variable values.
 *
 * Also injects %%ASSET_HASH%% — an 8-char content hash of app.js+app.css —
 * so browsers always load the latest assets after a deploy (cache-busting).
 *
 * Run automatically by netlify.toml [build] command.
 * Safe to run locally with a .env file loaded (via dotenv or export).
 */

'use strict';

const fs     = require('node:fs');
const path   = require('node:path');
const crypto = require('node:crypto');

// Load .env when running locally (netlify dev sets them automatically in CI/prod)
const envFile = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const VARS = {
  SUPABASE_URL:          process.env.SUPABASE_URL          || '',
  SUPABASE_ANON_KEY:     process.env.SUPABASE_ANON_KEY     || '',
  GOOGLE_OAUTH_CLIENT_ID:process.env.GOOGLE_OAUTH_CLIENT_ID|| '',
  META_APP_ID:           process.env.META_APP_ID           || '',
  META_PIXEL_ID:         process.env.META_PIXEL_ID         || '',
  STRIPE_PRICE_STARTER:  process.env.STRIPE_PRICE_STARTER  || '',
  STRIPE_PRICE_PRO:      process.env.STRIPE_PRICE_PRO      || '',
  STRIPE_PRICE_AGENCY:   process.env.STRIPE_PRICE_AGENCY   || '',
};

// HTML files that contain %%VAR%% placeholders
const HTML_FILES = [
  path.resolve(__dirname, '..', 'public', 'index.html'),
  path.resolve(__dirname, '..', 'public', 'admin', 'index.html'),
];

// Admin page only needs these two vars
const ADMIN_VARS = new Set(['SUPABASE_URL', 'SUPABASE_ANON_KEY']);

// Compute an 8-char hash of all frontend JS/CSS for cache-busting
const ASSETS_DIR  = path.resolve(__dirname, '..', 'public', 'assets');
const ADMIN_DIR   = path.resolve(__dirname, '..', 'public', 'admin');
const assetHash = (() => {
  const h = crypto.createHash('md5');
  for (const fp of [
    path.join(ASSETS_DIR, 'app.js'),
    path.join(ASSETS_DIR, 'app.css'),
    path.join(ASSETS_DIR, 'chat.css'),
    path.join(ADMIN_DIR,  'app.js'),
  ]) {
    if (fs.existsSync(fp)) h.update(fs.readFileSync(fp));
  }
  return h.digest('hex').slice(0, 8);
})();
process.stdout.write(`[inject-env] Asset hash: ${assetHash}\n`);

let allMissing = new Set();

for (const HTML_FILE of HTML_FILES) {
  const isAdmin = HTML_FILE.includes('admin');
  let html = fs.readFileSync(HTML_FILE, 'utf8');

  // Inject asset hash for cache-busting (placeholder on first run, existing hash on subsequent runs)
  html = html.replaceAll('%%ASSET_HASH%%', assetHash);
  html = html.replace(/(\?v=)[a-f0-9]+/g, `$1${assetHash}`);

  for (const [key, value] of Object.entries(VARS)) {
    if (isAdmin && !ADMIN_VARS.has(key)) continue;
    const safe = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    html = html.replaceAll(`%%${key}%%`, safe);
    if (!value) allMissing.add(key);
  }

  fs.writeFileSync(HTML_FILE, html, 'utf8');
  process.stdout.write(`[inject-env] Processed ${path.relative(path.resolve(__dirname, '..'), HTML_FILE)}\n`);
}

const missing = [...allMissing];
if (missing.length) {
  process.stderr.write(`[inject-env] WARNING: missing env vars: ${missing.join(', ')}\n`);
} else {
  process.stdout.write('[inject-env] All env vars injected successfully.\n');
}
