'use strict';

/**
 * research/planner.js
 * Translates depth_level into concrete hard caps for the pipeline.
 * ALL pipeline modules read limits from the plan object — never hardcode limits elsewhere.
 */

const DEPTH_PLANS = {
  low: {
    label:           'בדיקת שוק מהירה',
    maxCompetitors:  5,
    maxPlatforms:    2,
    maxAdsPerEntity: 3,
    maxSources:      5,
    maxSignals:      30,
    maxSegments:     2,
    maxAiCalls:      6,
    maxTokens:       8000,
    estimatedMinutes: 1,
    credits:         1,
    topCompetitors:  5,
    minSignalsRequired: 20,
    minInsights:     3,
  },
  medium: {
    label:           'מחקר שוק אסטרטגי',
    maxCompetitors:  10,
    maxPlatforms:    4,
    maxAdsPerEntity: 8,
    maxSources:      10,
    maxSignals:      100,
    maxSegments:     3,
    maxAiCalls:      14,
    maxTokens:       20000,
    estimatedMinutes: 3,
    credits:         3,
    topCompetitors:  7,
    minSignalsRequired: 50,
    minInsights:     5,
  },
  high: {
    label:           'מודיעין שוק עמוק',
    maxCompetitors:  20,
    maxPlatforms:    6,
    maxAdsPerEntity: 15,
    maxSources:      20,
    maxSignals:      250,
    maxSegments:     5,
    maxAiCalls:      28,
    maxTokens:       50000,
    estimatedMinutes: 7,
    credits:         6,
    topCompetitors:  10,
    minSignalsRequired: 100,
    minInsights:     8,
  },
};

function createPlan(depthLevel) {
  const plan = DEPTH_PLANS[depthLevel] || DEPTH_PLANS.low;
  return { ...plan, depthLevel };
}

function getPlanByLevel(level) {
  return DEPTH_PLANS[level] || DEPTH_PLANS.low;
}

module.exports = { createPlan, getPlanByLevel, DEPTH_PLANS };
