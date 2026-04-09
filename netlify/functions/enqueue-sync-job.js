const { accepted, fail } = require('./_shared/http');
const { createRequestContext, buildLogPayload } = require('./_shared/observability');
const { getAdminClient, writeRequestLog } = require('./_shared/supabase');
const { requireAuth } = require('./_shared/auth');
const { authorizeCampaignAccess } = require('./_shared/authz/access');
const { AppError } = require('./_shared/errors');
const { parseJsonBody, requireField } = require('./_shared/request');

exports.handler = async (event) => {
  const context = createRequestContext(event, 'enqueue-sync-job');
  try {
    if (event.httpMethod !== 'POST') {
      throw new AppError({ code: 'METHOD_NOT_ALLOWED', userMessage: 'Method not allowed', devMessage: 'Unsupported method', status: 405 });
    }
    const user = await requireAuth(event, context.functionName, context);
    const body = parseJsonBody(event, { fallback: {}, allowEmpty: false, devMessage: 'Invalid JSON in enqueue-sync-job body' });
    const campaignId = requireField(body.campaignId, 'campaignId');
    await authorizeCampaignAccess({ userId: user.id, campaignId: campaignId === 'global' ? null : campaignId, minRole: 'admin' });
    const { data, error } = await getAdminClient().from('sync_jobs').insert({
      user_id: user.id,
      campaign_id: campaignId,
      status: 'queued',
      payload: body,
    }).select('id,status').single();
    if (error || !data?.id) {
      throw new AppError({ code: 'DB_WRITE_FAILED', userMessage: 'יצירת המשימה נכשלה', devMessage: error?.message || 'sync job insert returned empty response', status: 500, details: { operationName: 'enqueue_sync_job', entityId: campaignId, userId: user.id } });
    }
    await writeRequestLog(buildLogPayload(context, 'info', 'sync_job_enqueued', { user_id: user.id, campaign_id: campaignId, job_id: data.id }));
    return accepted({ jobId: data.id, status: data.status }, context.requestId);
  } catch (error) {
    return fail(error, context.requestId);
  }
};
