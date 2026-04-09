const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const rootDir = path.resolve(__dirname, '../..');
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.APP_ENCRYPTION_KEY = process.env.APP_ENCRYPTION_KEY || 'test-encryption-key';

test('package includes runtime essentials and critical entry points resolve', async () => {
  const pkgPath = path.join(rootDir, 'package.json');
  assert.ok(fs.existsSync(pkgPath));
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  assert.equal(typeof pkg.scripts?.test, 'string');
  assert.equal(typeof pkg.scripts?.start, 'string');
  assert.equal(typeof pkg.scripts?.run, 'string');

  const paths = [
    '../../netlify/functions/enqueue-sync-job.js',
    '../../netlify/functions/process-sync-job.js',
    '../../netlify/functions/account-profile.js',
    '../../netlify/functions/account-delete.js',
    '../../netlify/functions/_shared/auth.js',
    '../../netlify/functions/_shared/authz/access.js',
    '../../netlify/functions/_shared/persistence.js',
    '../../netlify/functions/_shared/supabase.js',
    '../../netlify/functions/_shared/request.js',
    '../../netlify/functions/_shared/observability.js',
    '../../netlify/functions/_shared/analyze-service.js',
  ];

  for (const target of paths) {
    const resolved = require.resolve(target);
    assert.ok(resolved);
    assert.ok(require(target));
  }
});

test('package run script executes successfully on this exact package', async () => {
  const result = spawnSync(process.execPath, ['scripts/smoke-run.js'], { cwd: rootDir, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /ok/);
});
