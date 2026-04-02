// trigger-pending-jobs.js — Scheduled function that picks up queued sync jobs
//
// Configured in netlify.toml to run every 5 minutes:
//   [functions."trigger-pending-jobs"]
//     schedule = "* /5 * * * *"   (remove space between * and /5)
//
// It fetches up to MAX_BATCH queued jobs and self-invokes process-sync-job
// for each one via an internal HTTP call.

const { ok, fail }                              = require('./_shared/http');
const { createRequestContext, buildLogPayload }  = require('./_shared/observability');
const { writeRequestLog, getAdminClient }        = require('./_shared/supabase');

const MAX_BATCH    = 10;
const JOB_TIMEOUT  = 25_000; // ms — leave headroom under Netlify's 26s limit

async function processJob(jobId) {
  const baseUrl = process.env.APP_URL || 'https://localhost';
  const secret  = process.env.SYNC_JOB_INTERNAL_SECRET || '';
  const url     = `${baseUrl}/.netlify/functions/process-sync-job`;

  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), JOB_TIMEOUT);

  try {
    const res = await fetch(url, {
      method:  'POST',
      headers: {
        'Content-Type':     'application/json',
        'x-internal-secret': secret,
      },
      body:   JSON.stringify({ jobId }),
      signal: controller.signal,
    });
    return { jobId, status: res.status, ok: res.ok };
  } finally {
    clearTimeout(timeout);
  }
}

exports.handler = async (event) => {
  const context = createRequestContext(event, 'trigger-pending-jobs');

  try {
    const sb = getAdminClient();

    // Fetch oldest queued jobs
    const { data: jobs, error } = await sb
      .from('sync_jobs')
      .select('id')
      .eq('status', 'queued')
      .order('created_at', { ascending: true })
      .limit(MAX_BATCH);

    if (error) {
      await writeRequestLog(buildLogPayload(context, 'error', 'trigger_pending_jobs_fetch_failed', { error: error.message }));
      return fail({ message: error.message }, context.requestId);
    }

    if (!jobs || jobs.length === 0) {
      return ok({ triggered: 0, message: 'No pending jobs' }, context.requestId);
    }

    // Fire-and-forget: process each job (they handle their own locking)
    const results = await Promise.allSettled(jobs.map(j => processJob(j.id)));
    const triggered = results.filter(r => r.status === 'fulfilled' && r.value?.ok).length;
    const failed    = results.length - triggered;

    await writeRequestLog(buildLogPayload(context, 'info', 'trigger_pending_jobs_done', {
      total: jobs.length, triggered, failed,
    }));

    return ok({ triggered, failed, total: jobs.length }, context.requestId);
  } catch (error) {
    await writeRequestLog(buildLogPayload(context, 'error', 'trigger_pending_jobs_fatal', { error: error.message })).catch(() => {});
    return fail(error, context.requestId);
  }
};
