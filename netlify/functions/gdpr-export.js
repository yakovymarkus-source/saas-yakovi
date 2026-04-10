/**
 * gdpr-export.js — GDPR "right to data portability" export
 *
 * POST /gdpr-export
 * Returns a JSON bundle of all personal data belonging to the requesting user.
 */

const { ok, fail, options }                     = require('./_shared/http');
const { createRequestContext, buildLogPayload }  = require('./_shared/observability');
const { writeRequestLog, getAdminClient }        = require('./_shared/supabase');
const { requireAuth }                            = require('./_shared/auth');
const { writeAudit }                             = require('./_shared/audit');
const { AppError }                               = require('./_shared/errors');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options();
  const context = createRequestContext(event, 'gdpr-export');
  try {
    if (event.httpMethod !== 'POST') {
      throw new AppError({ code: 'METHOD_NOT_ALLOWED', userMessage: 'Method not allowed', devMessage: 'Unsupported method', status: 405 });
    }

    const user = await requireAuth(event, context.functionName, context);
    const sb   = getAdminClient();
    const uid  = user.id;

    // Collect all user-owned data in parallel
    const [
      profile,
      integrations,
      campaigns,
      analysisResults,
      decisionHistory,
      recommendations,
      syncJobs,
    ] = await Promise.all([
      sb.from('profiles')
        .select('id,email,name,onboarding_completed,created_at,updated_at')
        .eq('id', uid).maybeSingle().then(r => r.data),

      sb.from('user_integrations')
        .select('provider,account_id,property_id,metadata,created_at,updated_at')
        .eq('user_id', uid).then(r => r.data || []),

      sb.from('campaigns')
        .select('id,name,created_at,updated_at')
        .eq('owner_user_id', uid).then(r => r.data || []),

      sb.from('analysis_results')
        .select('id,campaign_id,timestamp,version,metrics,scores,bottlenecks,confidence,created_at')
        .eq('user_id', uid).order('timestamp', { ascending: false }).limit(500).then(r => r.data || []),

      sb.from('decision_history')
        .select('id,campaign_id,timestamp,verdict,reason,confidence,created_at')
        .eq('user_id', uid).order('timestamp', { ascending: false }).limit(500).then(r => r.data || []),

      sb.from('recommendations')
        .select('id,campaign_id,timestamp,issue,action,expected_impact,urgency,confidence,created_at')
        .eq('user_id', uid).order('timestamp', { ascending: false }).limit(500).then(r => r.data || []),

      sb.from('sync_jobs')
        .select('id,campaign_id,status,created_at,finished_at')
        .eq('user_id', uid).order('created_at', { ascending: false }).limit(200).then(r => r.data || []),
    ]);

    const exportBundle = {
      exportedAt:   new Date().toISOString(),
      userId:       uid,
      profile:      profile || {},
      integrations, // secrets intentionally excluded
      campaigns,
      analysisResults,
      decisionHistory,
      recommendations,
      syncJobs,
    };

    await writeAudit({ userId: uid, action: 'gdpr.export', ip: context.ip, requestId: context.requestId });
    await writeRequestLog(buildLogPayload(context, 'info', 'gdpr_export_created', { user_id: uid }));

    return ok(exportBundle, context.requestId);
  } catch (error) {
    await writeRequestLog(buildLogPayload(context, 'error', error.message || 'gdpr_export_failed', { code: error.code || 'INTERNAL_ERROR' })).catch(() => {});
    return fail(error, context.requestId);
  }
};
