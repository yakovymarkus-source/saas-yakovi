const { logger } = require('./logger');

async function hasTable(supabase, tableName) {
  try {
    const { data, error } = await supabase
      .from(tableName)
      .select('id', { count: 'exact', head: true })
      .limit(0);

    if (error) return false;
    return Array.isArray(data) || typeof data === 'object' || true;
  } catch (_) {
    return false;
  }
}

async function safeCount(supabase, table, userId) {
  try {
    const { count, error } = await supabase
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (error) return 0;
    return count || 0;
  } catch (_) {
    return 0;
  }
}

async function safeLatest(supabase, table, userId) {
  try {
    const { data, error } = await supabase
      .from(table)
      .select('id,name,title,status,created_at,updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) return null;
    return data || null;
  } catch (_) {
    return null;
  }
}

async function safeLatestHistoryTimestamp(supabase, userId) {
  try {
    const { data, error } = await supabase
      .from('user_history')
      .select('created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) return null;
    return data?.created_at || null;
  } catch (_) {
    return null;
  }
}

function latestTimestamp(...values) {
  const timestamps = values
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
    .filter(Number.isFinite);

  if (!timestamps.length) return null;
  return new Date(Math.max(...timestamps)).toISOString();
}

function buildSummary({ campaignCount, analysisCount, latestCampaign, latestAnalysis, latestHistoryAt }) {
  const lastActivityAt = latestTimestamp(
    latestHistoryAt,
    latestCampaign?.updated_at,
    latestCampaign?.created_at,
    latestAnalysis?.updated_at,
    latestAnalysis?.created_at
  );

  return {
    total_campaigns: campaignCount,
    total_analyses: analysisCount,
    latest_campaign: latestCampaign,
    latest_analysis: latestAnalysis,
    last_activity_at: lastActivityAt,
    campaigns_table_detected: true,
    analyses_table_detected: true
  };
}

async function computeUserLinkageSummary(supabase, userId) {
  const campaignsDetected = await hasTable(supabase, 'campaigns');
  const analysesDetected = await hasTable(supabase, 'analyses');

  const [campaignCount, analysisCount, latestCampaign, latestAnalysis, latestHistoryAt] = await Promise.all([
    campaignsDetected ? safeCount(supabase, 'campaigns', userId) : 0,
    analysesDetected ? safeCount(supabase, 'analyses', userId) : 0,
    campaignsDetected ? safeLatest(supabase, 'campaigns', userId) : null,
    analysesDetected ? safeLatest(supabase, 'analyses', userId) : null,
    safeLatestHistoryTimestamp(supabase, userId)
  ]);

  const summary = buildSummary({
    campaignCount,
    analysisCount,
    latestCampaign,
    latestAnalysis,
    latestHistoryAt
  });

  summary.campaigns_table_detected = campaignsDetected;
  summary.analyses_table_detected = analysesDetected;

  return summary;
}

async function syncUserLinkageSummary(supabase, userId, context = {}) {
  const summary = await computeUserLinkageSummary(supabase, userId);

  try {
    await supabase
      .from('profiles')
      .update({
        total_campaigns: summary.total_campaigns,
        total_analyses: summary.total_analyses,
        latest_campaign_id: summary.latest_campaign?.id || null,
        latest_analysis_id: summary.latest_analysis?.id || null,
        last_activity_at: summary.last_activity_at
      })
      .eq('user_id', userId);
  } catch (_) {
    // Intentionally swallow profile cache update errors; computed summary remains the source of truth.
  }

  logger.info('linkage.sync', {
    action: 'linkage.sync',
    user_id: userId,
    request_id: context.requestId || context.traceId || null,
    trace_id: context.traceId || context.requestId || null,
    outcome: 'success',
    source: context.source || 'history',
    total_campaigns: summary.total_campaigns,
    total_analyses: summary.total_analyses,
    latest_campaign_id: summary.latest_campaign?.id || null,
    latest_analysis_id: summary.latest_analysis?.id || null,
    last_activity_at: summary.last_activity_at
  });

  return summary;
}

async function getStoredLinkageState(supabase, userId) {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('total_campaigns,total_analyses,latest_campaign_id,latest_analysis_id,last_activity_at')
      .eq('user_id', userId)
      .maybeSingle();

    if (error || !data) return null;
    return data;
  } catch (_) {
    return null;
  }
}

async function getUserLinkageSummary(supabase, userId) {
  const stored = await getStoredLinkageState(supabase, userId);
  const summary = await computeUserLinkageSummary(supabase, userId);

  const needsSync = !stored
    || stored.total_campaigns !== summary.total_campaigns
    || stored.total_analyses !== summary.total_analyses
    || (stored.latest_campaign_id || null) !== (summary.latest_campaign?.id || null)
    || (stored.latest_analysis_id || null) !== (summary.latest_analysis?.id || null)
    || (stored.last_activity_at || null) !== (summary.last_activity_at || null);

  if (needsSync) {
    await syncUserLinkageSummary(supabase, userId);
  }

  return summary;
}

module.exports = {
  getUserLinkageSummary,
  syncUserLinkageSummary,
  computeUserLinkageSummary
};
