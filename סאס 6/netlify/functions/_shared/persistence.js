const { getAdminClient } = require('./supabase');
const { getEnv } = require('./env');
const { AppError } = require('./errors');

function ensureRpcSuccess(operationName, entityId, response, extraContext = {}) {
  if (response?.error) {
    throw new AppError({
      code: 'DB_WRITE_FAILED',
      userMessage: 'שמירת הנתונים נכשלה.',
      devMessage: `${operationName} failed for ${entityId}: ${response.error.message}`,
      status: 500,
      details: {
        operationName,
        entityId,
        ...extraContext,
      },
    });
  }

  if (response?.data == null || response?.data === '') {
    throw new AppError({
      code: 'DB_WRITE_FAILED',
      userMessage: 'שמירת הנתונים נכשלה.',
      devMessage: `${operationName} returned empty response for ${entityId}`,
      status: 500,
      details: {
        operationName,
        entityId,
        ...extraContext,
      },
    });
  }

  if (typeof response.data !== 'string') {
    throw new AppError({
      code: 'DB_WRITE_FAILED',
      userMessage: 'שמירת הנתונים נכשלה.',
      devMessage: `${operationName} returned invalid response shape for ${entityId}`,
      status: 500,
      details: {
        operationName,
        entityId,
        ...extraContext,
      },
    });
  }

  return response.data;
}

async function persistAnalysis({ userId, campaignId, requestId, rawSnapshot, metrics, scores, bottlenecks, decisions, recommendations, confidence }) {
  const sb = getAdminClient();
  const version = getEnv().ANALYSIS_VERSION;
  const timestamp = new Date().toISOString();

  const payload = {
    analysis_result: {
      user_id: userId,
      campaign_id: campaignId,
      request_id: requestId,
      timestamp,
      version,
      raw_snapshot: rawSnapshot,
      metrics,
      scores,
      bottlenecks,
      confidence,
    },
    campaign_snapshot: {
      user_id: userId,
      campaign_id: campaignId,
      timestamp,
      version,
      raw_metrics_snapshot: rawSnapshot,
      computed_scores: scores,
    },
    decisions: Array.isArray(decisions) ? decisions.map((item) => ({
      user_id: userId,
      campaign_id: campaignId,
      timestamp,
      version,
      verdict: item.verdict,
      reason: item.reason,
      confidence: item.confidence,
    })) : [],
    recommendations: Array.isArray(recommendations) ? recommendations.map((item) => ({
      user_id: userId,
      campaign_id: campaignId,
      timestamp,
      version,
      issue: item.issue,
      root_cause: item.rootCause,
      action: item.action,
      expected_impact: item.expectedImpact,
      urgency: item.urgency,
      effort: item.effort,
      confidence: item.confidence,
      priority_score: item.priorityScore,
    })) : [],
  };

  const data = ensureRpcSuccess(
    'persist_analysis_atomic',
    requestId || campaignId || userId,
    await sb.rpc('persist_analysis_atomic', { p_payload: payload }),
    { userId, campaignId, requestId },
  );

  return data;
}

async function getPreviousAnalysis(userId, campaignId) {
  const { data } = await getAdminClient()
    .from('analysis_results')
    .select('*')
    .eq('user_id', userId)
    .eq('campaign_id', campaignId)
    .order('timestamp', { ascending: false })
    .limit(2);

  if (!Array.isArray(data) || data.length < 2) return null;
  return data[1];
}

module.exports = { persistAnalysis, getPreviousAnalysis, ensureRpcSuccess };
