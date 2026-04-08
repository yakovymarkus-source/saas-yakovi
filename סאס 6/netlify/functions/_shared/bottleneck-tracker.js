'use strict';

/**
 * bottleneck-tracker.js — Phase 4F: Bottleneck Diagnosis
 *
 * Compares current analysis metrics against the previous persisted analysis.
 * Identifies the direction of change (improving / declining / stable) for each
 * key metric and determines which funnel stage is the primary bottleneck.
 *
 * Pure computation — zero DB calls. Caller provides both snapshots.
 *
 * Input:
 *   currentMetrics  — merged metrics from analyze-service (ctr, convRate, roas, spend…)
 *   currentScores   — scores object from scoreMetrics() { overall, ctr, conversion, roas… }
 *   previousAnalysis — row from analysis_results (or null if no history)
 *
 * Output: BottleneckDelta
 *   {
 *     hasPrevious: boolean,
 *     deltas: { ctr, convRate, roas, score } each → { direction, delta },
 *     stageDelta: 'improving' | 'declining' | 'critical_decline' | 'stable',
 *     primaryStage: 'creative' | 'landing_page' | 'budget' | null,
 *     prevTimestamp: string | null,
 *   }
 */

// Minimum absolute change required to call a direction "meaningful"
const THRESHOLDS = {
  ctr:      0.002,   // 0.2% absolute — meaningful CTR shift
  convRate: 0.005,   // 0.5% absolute — meaningful conversion shift
  roas:     0.30,    // 0.3x — meaningful ROAS shift
  score:    5,       // 5 overall-score points
};

/**
 * classifyDelta(current, previous, threshold)
 * Returns direction and raw numeric delta.
 */
function classifyDelta(current, previous, threshold) {
  const delta = (current || 0) - (previous || 0);
  if (Math.abs(delta) < threshold) return { direction: 'stable', delta };
  return { direction: delta > 0 ? 'improving' : 'declining', delta };
}

/**
 * trackBottlenecks(currentMetrics, currentScores, previousAnalysis)
 *
 * @param {object}      currentMetrics   — from mergeMetrics() in analyze-service
 * @param {object}      currentScores    — from scoreMetrics()
 * @param {object|null} previousAnalysis — row from analysis_results, may be null
 * @returns {object}    BottleneckDelta
 */
function trackBottlenecks(currentMetrics, currentScores, previousAnalysis) {
  if (!previousAnalysis) {
    return {
      hasPrevious:  false,
      deltas:       {},
      stageDelta:   'stable',
      primaryStage: null,
      prevTimestamp: null,
    };
  }

  const prevMetrics = previousAnalysis.metrics || {};
  const prevScores  = previousAnalysis.scores  || {};

  const deltas = {
    ctr:      classifyDelta(currentMetrics.ctr      || 0, prevMetrics.ctr      || 0, THRESHOLDS.ctr),
    convRate: classifyDelta(currentMetrics.convRate || 0, prevMetrics.convRate || 0, THRESHOLDS.convRate),
    roas:     classifyDelta(currentMetrics.roas     || 0, prevMetrics.roas     || 0, THRESHOLDS.roas),
    score:    classifyDelta(currentScores.overall   || 0, prevScores.overall   || 0, THRESHOLDS.score),
  };

  // Count direction votes
  const dirs = Object.values(deltas).map(d => d.direction);
  const declineCount  = dirs.filter(d => d === 'declining').length;
  const improveCount  = dirs.filter(d => d === 'improving').length;

  let stageDelta = 'stable';
  if (improveCount >= 2)   stageDelta = 'improving';
  if (declineCount >= 2)   stageDelta = 'declining';
  if (declineCount >= 3)   stageDelta = 'critical_decline';

  // Primary bottleneck: first declining metric by funnel order
  let primaryStage = null;
  if      (deltas.ctr.direction      === 'declining') primaryStage = 'creative';
  else if (deltas.convRate.direction === 'declining') primaryStage = 'landing_page';
  else if (deltas.roas.direction     === 'declining') primaryStage = 'budget';

  return {
    hasPrevious:   true,
    deltas,
    stageDelta,
    primaryStage,
    prevTimestamp: previousAnalysis.timestamp || null,
  };
}

module.exports = { trackBottlenecks };
