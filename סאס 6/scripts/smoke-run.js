const path = require('node:path');

const entryPoints = [
  './netlify/functions/enqueue-sync-job.js',
  './netlify/functions/process-sync-job.js',
  './netlify/functions/account-profile.js',
  './netlify/functions/account-delete.js',
  './netlify/functions/_shared/auth.js',
  './netlify/functions/_shared/authz/access.js',
  './netlify/functions/_shared/persistence.js',
  './netlify/functions/_shared/supabase.js',
  './netlify/functions/_shared/request.js',
  './netlify/functions/_shared/observability.js',
  './netlify/functions/_shared/analyze-service.js',
];

for (const target of entryPoints) {
  require(path.resolve(__dirname, '..', target));
}

process.stdout.write('ok\n');
