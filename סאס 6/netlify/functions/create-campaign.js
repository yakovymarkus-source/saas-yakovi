/**
 * create-campaign.js — Create a campaign with plan quota enforcement
 *
 * POST /create-campaign  { name: string }
 */

const { ok, fail }                              = require('./_shared/http');
const { createRequestContext, buildLogPayload }  = require('./_shared/observability');
const { writeRequestLog, getAdminClient }        = require('./_shared/supabase');
const { requireAuth }                            = require('./_shared/auth');
const { assertCampaignLimit }                    = require('./_shared/billing');
const { AppError }                               = require('./_shared/errors');
const { parseJsonBody, requireField }            = require('./_shared/request');
const { writeAudit }                             = require('./_shared/audit');
const crypto                                     = require('node:crypto');

exports.handler = async (event) => {
  const context = createRequestContext(event, 'create-campaign');
  try {
    if (event.httpMethod !== 'POST') {
      throw new AppError({ code: 'METHOD_NOT_ALLOWED', userMessage: 'Method not allowed', devMessage: 'Unsupported method', status: 405 });
    }

    const user = await requireAuth(event, context.functionName, context);
    const body = parseJsonBody(event, { fallback: {}, allowEmpty: false, devMessage: 'Invalid JSON in create-campaign body' });
    const name = requireField(body.name?.trim(), 'name');

    if (name.length > 200) {
      throw new AppError({ code: 'BAD_REQUEST', userMessage: 'שם הקמפיין ארוך מדי (מקסימום 200 תווים)', devMessage: 'Campaign name too long', status: 400 });
    }

    // Enforce plan quota before insert
    await assertCampaignLimit(user.id);

    const id = crypto.randomUUID();
    const sb = getAdminClient();

    const { data, error } = await sb
      .from('campaigns')
      .insert({ id, name, owner_user_id: user.id })
      .select('id, name, created_at')
      .single();

    if (error || !data) {
      throw new AppError({ code: 'DB_WRITE_FAILED', userMessage: 'יצירת הקמפיין נכשלה', devMessage: error?.message || 'empty response', status: 500 });
    }

    await writeAudit({ userId: user.id, action: 'campaign.create', targetType: 'campaign', targetId: data.id, ip: context.ip, requestId: context.requestId });
    await writeRequestLog(buildLogPayload(context, 'info', 'campaign_created', { user_id: user.id, campaign_id: data.id }));

    return ok(data, context.requestId);
  } catch (error) {
    await writeRequestLog(buildLogPayload(context, 'error', error.message || 'create_campaign_failed', { code: error.code || 'INTERNAL_ERROR' })).catch(() => {});
    return fail(error, context.requestId);
  }
};
