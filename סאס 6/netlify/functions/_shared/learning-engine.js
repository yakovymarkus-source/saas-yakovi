'use strict';

/**
 * learning-engine.js — Phase 4F: Strategic Learning
 *
 * Reads the last N analysis_results for a (user, campaign) and computes:
 *   - score trend (improving / declining / stable)
 *   - persistent bottlenecks (stages that recur across multiple analyses)
 *   - dominant verdict type over the period
 *
 * Then writes the result to strategy_memory (one row per user+campaign, upserted).
 * Also provides loadStrategyMemory() so the chat pipeline can read pre-computed data.
 *
 * All writes are fire-and-forget from analyze-service — never block the main pipeline.
 */

const { getAdminClient } = require('./supabase');

const LOOKBACK          = 7;   // analyse up to 7 recent runs
const PERSISTENT_FLOOR  = 3;   // bottleneck must appear this many times to be "persistent"

// ── Internal readers ──────────────────────────────────────────────────────────

/**
 * loadRecentAnalyses(userId, campaignId)
 * Returns last LOOKBACK rows from analysis_results, newest first.
 */
async function loadRecentAnalyses(userId, campaignId) {
  const { data, error } = await getAdminClient()
    .from('analysis_results')
    .select('id, timestamp, scores, metrics, bottlenecks, confidence')
    .eq('user_id', userId)
    .eq('campaign_id', campaignId)
    .order('timestamp', { ascending: false })
    .limit(LOOKBACK);

  if (error) {
    console.warn('[learning-engine] load analyses failed:', error.message);
    return [];
  }
  return data || [];
}

// ── Computation ───────────────────────────────────────────────────────────────

/**
 * computeScoreTrend(analyses)
 * Compares newest vs oldest overall score.
 */
function computeScoreTrend(analyses) {
  if (analyses.length < 2) return { trend: 'stable', delta: 0 };
  const latest  = analyses[0].scores?.overall                    ?? 0;
  const oldest  = analyses[analyses.length - 1].scores?.overall  ?? 0;
  const delta   = Math.round((latest - oldest) * 10) / 10;
  const trend   = delta > 5 ? 'improving' : delta < -5 ? 'declining' : 'stable';
  return { trend, delta };
}

/**
 * findPersistentBottlenecks(analyses)
 * Returns bottleneck stage names that appear in >= PERSISTENT_FLOOR analyses.
 */
function findPersistentBottlenecks(analyses) {
  const counts = {};
  for (const a of analyses) {
    const bns = Array.isArray(a.bottlenecks) ? a.bottlenecks : [];
    for (const bn of bns) {
      counts[bn] = (counts[bn] || 0) + 1;
    }
  }
  return Object.entries(counts)
    .filter(([, n]) => n >= PERSISTENT_FLOOR)
    .sort((a, b) => b[1] - a[1])
    .map(([stage]) => stage);
}

/**
 * findDominantVerdict(analyses)
 * Maps overall score to a verdict bucket and returns the most frequent.
 */
function findDominantVerdict(analyses) {
  const counts = {};
  for (const a of analyses) {
    const score   = a.scores?.overall ?? 0;
    const bucket  = score >= 70 ? 'healthy' : score >= 40 ? 'needs_work' : 'critical';
    counts[bucket] = (counts[bucket] || 0) + 1;
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return sorted[0]?.[0] || 'needs_work';
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * runLearningEngine(userId, campaignId)
 *
 * Reads history and returns a structured LearningResult, or null if < 2 data points.
 * Call this after a new analysis has been persisted.
 *
 * @returns {object|null} LearningResult
 *   {
 *     dataPoints, periodStart, periodEnd,
 *     scoreTrend, scoreDelta,
 *     persistentBottlenecks,
 *     dominantVerdict,
 *     latestScore, earliestScore,
 *   }
 */
async function runLearningEngine(userId, campaignId) {
  if (!userId || !campaignId) return null;

  const analyses = await loadRecentAnalyses(userId, campaignId);
  if (analyses.length < 2) return null;   // need at least 2 runs to learn anything

  const { trend, delta }     = computeScoreTrend(analyses);
  const persistentBottlenecks = findPersistentBottlenecks(analyses);
  const dominantVerdict       = findDominantVerdict(analyses);

  return {
    dataPoints:            analyses.length,
    periodStart:           analyses[analyses.length - 1].timestamp,
    periodEnd:             analyses[0].timestamp,
    scoreTrend:            trend,
    scoreDelta:            delta,
    persistentBottlenecks,
    dominantVerdict,
    latestScore:           analyses[0].scores?.overall                    ?? 0,
    earliestScore:         analyses[analyses.length - 1].scores?.overall  ?? 0,
  };
}

// ── Persistence ───────────────────────────────────────────────────────────────

/**
 * persistStrategyMemory(userId, campaignId, learningResult, iterationAction)
 *
 * Upserts to strategy_memory. Called fire-and-forget — never throws.
 * iterationAction is the output of buildIterationAction().
 */
async function persistStrategyMemory(userId, campaignId, learningResult, iterationAction) {
  if (!learningResult) return;
  try {
    await getAdminClient()
      .from('strategy_memory')
      .upsert(
        {
          user_id:                userId,
          campaign_id:            campaignId,
          period_start:           learningResult.periodStart,
          period_end:             learningResult.periodEnd,
          data_points:            learningResult.dataPoints,
          persistent_bottlenecks: learningResult.persistentBottlenecks,
          score_trend:            learningResult.scoreTrend,
          score_delta:            learningResult.scoreDelta,
          dominant_verdict:       learningResult.dominantVerdict,
          iteration_action:       iterationAction || null,
          updated_at:             new Date().toISOString(),
        },
        { onConflict: 'user_id,campaign_id' }
      );
  } catch (e) {
    console.warn('[learning-engine] persist strategy_memory failed:', e.message);
  }
}

// ── Chat read ─────────────────────────────────────────────────────────────────

/**
 * loadStrategyMemory(userId, campaignId)
 *
 * Reads the pre-computed strategy_memory for a given campaign.
 * If campaignId is null, returns the most recently updated row for the user
 * (useful for chat context where we may not know a specific campaign).
 *
 * @returns {object|null}
 */
async function loadStrategyMemory(userId, campaignId) {
  if (!userId) return null;
  try {
    let query = getAdminClient()
      .from('strategy_memory')
      .select('*')
      .eq('user_id', userId);

    if (campaignId) {
      query = query.eq('campaign_id', campaignId);
    } else {
      query = query.order('updated_at', { ascending: false });
    }

    const { data } = await query.limit(1).maybeSingle();
    return data || null;
  } catch (e) {
    console.warn('[learning-engine] load strategy_memory failed:', e.message);
    return null;
  }
}

module.exports = {
  runLearningEngine,
  persistStrategyMemory,
  loadStrategyMemory,
};
