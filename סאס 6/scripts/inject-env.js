/**
 * inject-env.js — Build step: replace %%VAR%% placeholders in index.html
 * with real Netlify environment variable values.
 *
 * Run automatically by netlify.toml [build] command.
 * Safe to run locally with a .env file loaded (via dotenv or export).
 */

'use strict';

const fs   = require('node:fs');
const path = require('node:path');

const VARS = {
  SUPABASE_URL:          process.env.SUPABASE_URL          || '',
  SUPABASE_ANON_KEY:     process.env.SUPABASE_ANON_KEY     || '',
  GOOGLE_OAUTH_CLIENT_ID:process.env.GOOGLE_OAUTH_CLIENT_ID|| '',
  META_APP_ID:           process.env.META_APP_ID           || '',
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

let allMissing = new Set();

for (const HTML_FILE of HTML_FILES) {
  const isAdmin = HTML_FILE.includes('admin');
  let html = fs.readFileSync(HTML_FILE, 'utf8');

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
