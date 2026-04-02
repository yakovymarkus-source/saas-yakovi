const { persistAnalysis } = require('./persistence');
const { AppError } = require('./errors');

function buildDecisions(metrics) {
  return [{
    verdict: metrics.clicks > 0 ? 'healthy' : 'no-traffic',
    reason: metrics.clicks > 0 ? 'Traffic exists' : 'No clicks detected',
    confidence: 85,
  }];
}

function buildRecommendations(metrics) {
  return [{
    issue: metrics.clicks > 0 ? 'optimize-conversion' : 'generate-traffic',
    rootCause: metrics.clicks > 0 ? 'Low conversion signal' : 'Traffic missing',
    action: metrics.clicks > 0 ? 'Review landing page and audience' : 'Fix tracking and launch traffic campaign',
    expectedImpact: metrics.clicks > 0 ? 'Higher conversion rate' : 'Restored demand signal',
    urgency: 70,
    effort: 35,
    confidence: 81,
    priorityScore: 88,
  }];
}

async function analyzeCampaign({ userId, campaignId, query = {}, requestId }) {
  if (!userId || !campaignId) {
    throw new AppError({ code: 'BAD_REQUEST', userMessage: 'נתוני ניתוח חסרים', devMessage: 'Missing analysis identifiers', status: 400 });
  }

  const rawSnapshot = {
    source: 'sync_job',
    query,
    totals: query.totals || { clicks: query.clicks || 0, impressions: query.impressions || 0 },
  };
  const metrics = {
    clicks: Number(query.clicks || rawSnapshot.totals.clicks || 0),
    impressions: Number(query.impressions || rawSnapshot.totals.impressions || 0),
  };
  const scores = { overall: metrics.clicks > 0 ? 78 : 20 };
  const decisions = buildDecisions(metrics);
  const recommendations = buildRecommendations(metrics);

  const analysisId = await persistAnalysis({
    userId,
    campaignId,
    requestId,
    rawSnapshot,
    metrics,
    scores,
    bottlenecks: metrics.clicks > 0 ? [] : ['traffic'],
    decisions,
    recommendations,
    confidence: 82,
  });

  if (!analysisId) {
    throw new AppError({ code: 'DB_WRITE_FAILED', userMessage: 'שמירת הניתוח נכשלה', devMessage: 'persistAnalysis returned empty analysis id', status: 500 });
  }

  return { analysisId, scores, decisions, recommendations };
}

module.exports = { analyzeCampaign };
