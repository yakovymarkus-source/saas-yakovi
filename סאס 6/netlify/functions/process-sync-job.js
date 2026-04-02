const { ok, fail } = require('./_shared/http');
const { createRequestContext, buildLogPayload } = require('./_shared/observability');
const supabase = require('./_shared/supabase');
const { AppError } = require('./_shared/errors');
const { analyzeCampaign } = require('./_shared/analyze-service');
const { requireAuthOrInternal } = require('./_shared/auth');
const { parseJsonBody, requireField } = require('./_shared/request');

function getAdminClient() {
  return supabase.getAdminClient();
}

async function writeLogSafe(payload) {
  if (!Object.prototype.hasOwnProperty.call(supabase, 'writeRequestLog')) return;
  if (typeof supabase.writeRequestLog !== 'function') return;
  await supabase.writeRequestLog(payload);
}

function getJobId(event) {
  const queryJobId = event.queryStringParameters?.jobId;
  if (queryJobId) return queryJobId;
  if (event.httpMethod === 'POST') {
    const body = parseJsonBody(event, { fallback: {}, allowEmpty: true, devMessage: 'Invalid JSON in process-sync-job body' });
    return body.jobId;
  }
  return undefined;
}

function assertDbMutation(operationName, entityId, response, extra = {}) {
  if (response?.error) {
    throw new AppError({
      code: 'DB_WRITE_FAILED',
      userMessage: 'עדכון המשימה נכשל',
      devMessage: `${operationName} failed for ${entityId}: ${response.error.message}`,
      status: 500,
      details: { operationName, entityId, ...extra },
    });
  }
  if (response?.data == null) {
    throw new AppError({
      code: 'DB_WRITE_FAILED',
      userMessage: 'עדכון המשימה נכשל',
      devMessage: `${operationName} returned empty response for ${entityId}`,
      status: 500,
      details: { operationName, entityId, ...extra },
    });
  }
  return response.data;
}

async function loadJob(sb, jobId) {
  const response = await sb.from('sync_jobs').select('*').eq('id', jobId).maybeSingle();
  if (response.error) {
    throw new AppError({ code: 'DB_READ_FAILED', userMessage: 'טעינת המשימה נכשלה', devMessage: response.error.message, status: 500, details: { operationName: 'load_sync_job', entityId: jobId } });
  }
  if (!response.data) {
    throw new AppError({ code: 'NOT_FOUND', userMessage: 'המשימה לא נמצאה', devMessage: 'Job not found', status: 404, details: { jobId } });
  }
  return response.data;
}

async function claimJob(sb, jobId) {
  const response = await sb
    .from('sync_jobs')
    .update({ status: 'running', started_at: new Date().toISOString(), error_message: null })
    .eq('id', jobId)
    .eq('status', 'queued')
    .select('id,status,user_id,campaign_id,payload')
    .maybeSingle();

  if (response.error) {
    throw new AppError({
      code: 'DB_WRITE_FAILED',
      userMessage: 'נעילת המשימה נכשלה',
      devMessage: `claim_sync_job failed for ${jobId}: ${response.error.message}`,
      status: 500,
      details: { operationName: 'claim_sync_job', entityId: jobId },
    });
  }

  if (!response.data) {
    throw new AppError({
      code: 'JOB_ALREADY_PROCESSING',
      userMessage: 'המשימה כבר בעיבוד או הושלמה',
      devMessage: `Job ${jobId} is not in queued state`,
      status: 409,
      details: { operationName: 'claim_sync_job', entityId: jobId },
    });
  }

  return response.data;
}

async function markJobDone(sb, jobId, result) {
  assertDbMutation(
    'complete_sync_job',
    jobId,
    await sb
      .from('sync_jobs')
      .update({ status: 'done', finished_at: new Date().toISOString(), result_payload: result, error_message: null })
      .eq('id', jobId)
      .eq('status', 'running')
      .select('id')
      .maybeSingle(),
  );
}

async function markJobFailed(sb, jobId, error) {
  const response = await sb
    .from('sync_jobs')
    .update({ status: 'failed', finished_at: new Date().toISOString(), error_message: error.message || 'failed' })
    .eq('id', jobId)
    .eq('status', 'running')
    .select('id')
    .maybeSingle();

  return assertDbMutation('fail_sync_job', jobId, response);
}

exports.handler = async (event) => {
  const context = createRequestContext(event, 'process-sync-job');
  let jobId;
  let hasClaimedJob = false;
  let finalError = null;
  try {
    const access = await requireAuthOrInternal(event, context.functionName, context);
    await writeLogSafe(buildLogPayload(context, 'info', 'process_sync_job_authenticated', { auth_mode: access.mode })).catch(() => {});
    jobId = requireField(getJobId(event), 'jobId', { location: 'query/body' });

    const sb = getAdminClient();
    const job = await loadJob(sb, jobId);

    if (access.mode === 'user' && job.user_id !== access.user.id) {
      throw new AppError({
        code: 'FORBIDDEN',
        userMessage: 'אין לך הרשאה למשימה הזאת',
        devMessage: `User ${access.user.id} cannot access job ${jobId}`,
        status: 403,
        details: { jobId, userId: access.user.id },
      });
    }

    const claimedJob = await claimJob(sb, jobId);
    hasClaimedJob = true;
    await writeLogSafe(buildLogPayload(context, 'info', 'process_sync_job_claimed', { job_id: jobId, campaign_id: claimedJob.campaign_id, user_id: claimedJob.user_id })).catch(() => {});
    const result = await analyzeCampaign({
      userId: claimedJob.user_id,
      campaignId: claimedJob.campaign_id,
      query: claimedJob.payload || {},
      requestId: context.requestId,
    });

    await markJobDone(sb, jobId, result);
    await writeLogSafe(buildLogPayload(context, 'info', 'process_sync_job_done', { job_id: jobId, analysis_id: result.analysisId, campaign_id: claimedJob.campaign_id, user_id: claimedJob.user_id })).catch(() => {});
    return ok({ jobId, status: 'done', analysisId: result.analysisId }, context.requestId);
  } catch (error) {
    finalError = error;
    if (jobId && hasClaimedJob) {
      try {
        await markJobFailed(getAdminClient(), jobId, error);
      } catch (markFailedError) {
        finalError = markFailedError;
      }
    }
    await writeLogSafe(buildLogPayload(context, 'error', 'process_sync_job_failed', { job_id: jobId || null, code: finalError.code || 'INTERNAL_ERROR', claimed: hasClaimedJob })).catch(() => {});
    return fail(finalError, context.requestId);
  }
};
