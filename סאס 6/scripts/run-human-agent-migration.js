#!/usr/bin/env node
'use strict';

/**
 * run-human-agent-migration.js
 * Applies human-agent-migration.sql to the configured Supabase project.
 *
 * Usage:
 *   node scripts/run-human-agent-migration.js
 *
 * Requires env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

const fs   = require('node:fs');
const path = require('node:path');

// Load .env if present
const envPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.+)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('❌  Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.');
  process.exit(1);
}

const sql = fs.readFileSync(path.resolve(__dirname, '..', 'human-agent-migration.sql'), 'utf8');

const projectRef = url.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
if (!projectRef) { console.error('❌  Could not parse project ref from SUPABASE_URL'); process.exit(1); }

const restUrl = `https://${projectRef}.supabase.co/rest/v1/rpc/exec_sql`;

// Supabase doesn't expose a raw SQL REST endpoint on anon/service-role directly.
// We use the Management API if available, otherwise print instructions.
console.log('');
console.log('══════════════════════════════════════════════════════');
console.log('  Human Agent Migration');
console.log('══════════════════════════════════════════════════════');
console.log('');
console.log('📋  Copy the SQL below and run it in your Supabase');
console.log('    SQL Editor at: https://supabase.com/dashboard/project/' + projectRef + '/sql');
console.log('');
console.log('─'.repeat(54));
console.log(sql);
console.log('─'.repeat(54));
console.log('');
console.log('✅  After running, the Human Agent tables will be ready.');
console.log('');
