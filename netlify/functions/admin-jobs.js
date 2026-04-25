'use strict';

const { ok, fail, options }                    = require('./_shared/http');
const { createRequestContext, buildLogPayload } = require('./_shared/observability');
const { writeRequestLog, getAdminClient }       = require('./_shared/supabase');
const { requireAdmin }                          = require('./_shared/admin-auth');
const { writeAudit }                            = require('./_shared/audit');
const { AppError }                              = require('./_shared/errors');

const PAGE_LIMIT = 30;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options();
  const context = createRequestContext(event, 'admin-jobs');
  try {
    const admin = await requireAdmin(event, context.functionName, context);
    const sb    = getAdminClient();

    // ── GET — list jobs ───────────────────────────────────────────────────────
    if (event.httpMethod === 'GET') {
      const params = event.queryStringParameters || {};
      const page   = Math.max(1, parseInt(params.page  || '1', 10));
      const limit  = Math.min(100, parseInt(params.limit || String(PAGE_LIMIT), 10));
      const offset = (page - 1) * limit;

      let q = sb.from('sync_jobs')
        .select('id, user_id, campaign_id, status, error_message, created_at, started_at, finished_at, updated_at, retry_count', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (params.status)     q = q.eq('status', params.status);
      if (params.userId)     q = q.eq('user_id', params.userId);
      if (params.campaignId) q = q.eq('campaign_id', params.campaignId);
      if (params.since)      q = q.gte('created_at', params.since);

      const { data: jobs, count: total, error } = await q;
      if (error) throw new AppError({ code: 'DB_READ_FAILED', devMessage: error.message, status: 500 });

      // Enrich with user emails
      const userIds = [...new Set((jobs || []).map(j => j.user_id).filter(Boolean))];
      let emailMap  = {};
      if (userIds.length > 0) {
        const { data: profiles } = await sb.from('profiles').select('id, email').in('id', userIds);
        emailMap = Object.fromEntries((profiles || []).map(p => [p.id, p.email]));
      }

      const enriched = (jobs || []).map(j => ({
        ...j,
        userEmail:  emailMap[j.user_id] || null,
        durationMs: j.started_at && j.finished_at
          ? new Date(j.finished_at).getTime() - new Date(j.started_at).getTime()
          : null,
      }));

      // Status summary
      const summaryRes = await sb.from('sync_jobs')
        .select('status')
        .gte('created_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString());
      const summary = (summaryRes.data || []).reduce((m, j) => {
        m[j.status] = (m[j.status] || 0) + 1;
        return m;
      }, {});

      await writeRequestLog(buildLogPayload(context, 'info', 'admin_jobs_read', { page, limit }));
      return ok({ jobs: enriched, total, page, limit, summary24h: summary }, context.requestId);
    }

    // ── POST — retry / cancel job ─────────────────────────────────────────────
    if (event.httpMethod === 'POST') {
      let body;
      try { body = JSON.parse(event.body || '{}'); } catch {
        throw new AppError({ code: 'BAD_REQUEST', userMessage: 'Invalid JSON', status: 400 });
      }
      const { action, jobId } = body;
      if (!action || !jobId) throw new AppError({ code: 'BAD_REQUEST', userMessage: 'action and jobId required', status: 400 });

      const { data: job } = await sb.from('sync_jobs').select('*').eq('id', jobId).maybeSingle();
      if (!job) throw new AppError({ code: 'NOT_FOUND', userMessage: 'Job not found', status: 404 });

      if (action === 'retry') {
        if (!['failed', 'canceled', 'timed_out'].includes(job.status)) {
          throw new AppError({ code: 'BAD_REQUEST', userMessage: `Cannot retry job with status: ${job.status}`, status: 400 });
        }
        await sb.from('sync_jobs').update({
          status:        'queued',
          error_message: null,
          retry_count:   (job.retry_count || 0) + 1,
          started_at:    null,
          finished_at:   null,
          updated_at:    new Date().toISOString(),
        }).eq('id', jobId);

        await writeAudit({
          userId: admin.id, action: 'admin.retry_job',
          targetId: jobId, targetType: 'job',
          metadata: { campaignId: job.campaign_id, userId: job.user_id, prevStatus: job.status },
          ip: context.ip, requestId: context.requestId,
        });

        await writeRequestLog(buildLogPayload(context, 'info', 'admin_job_retried', { jobId }));
        return ok({ ok: true, jobId, newStatus: 'queued' }, context.requestId);
      }

      if (action === 'cancel') {
        if (['completed', 'canceled'].includes(job.status)) {
          throw new AppError({ code: 'BAD_REQUEST', userMessage: `Job already ${job.status}`, status: 400 });
        }
        await sb.from('sync_jobs').update({
          status:     'canceled',
          updated_at: new Date().toISOString(),
        }).eq('id', jobId);

        await writeAudit({
          userId: admin.id, action: 'admin.cancel_job',
          targetId: jobId, targetType: 'job',
          metadata: { campaignId: job.campaign_id, prevStatus: job.status },
          ip: context.ip, requestId: context.requestId,
        });

        return ok({ ok: true, jobId, newStatus: 'canceled' }, context.requestId);
      }

      throw new AppError({ code: 'BAD_REQUEST', userMessage: `Unknown action: ${action}`, status: 400 });
    }

    throw new AppError({ code: 'METHOD_NOT_ALLOWED', status: 405 });
  } catch (error) {
    await writeRequestLog(buildLogPayload(context, 'error', 'admin_jobs_failed', { code: error.code })).catch(() => {});
    return fail(error, context.requestId);
  }
};
