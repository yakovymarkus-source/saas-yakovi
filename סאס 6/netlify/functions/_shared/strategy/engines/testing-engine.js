'use strict';
/**
 * strategy/engines/testing-engine.js
 * Module 5 (Testing Engine): Generates structured A/B test plan.
 * Produces 2-3 variants per dimension. AI fills the hypotheses content.
 */

function buildTestDimensions({ backupPains, positioningOptions, angles }) {
  return {
    pain_variants: backupPains.slice(0, 2).map((p, i) => ({
      id:        `pain_${i + 1}`,
      type:      'pain',
      value:     p,
      hypothesis: null, // AI fills
    })),
    angle_variants: (angles || []).slice(0, 3).map((a, i) => ({
      id:        `angle_${i + 1}`,
      type:      'angle',
      value:     typeof a === 'string' ? a : a.text,
      hypothesis: null,
    })),
    message_variants: (positioningOptions || []).slice(0, 2).map((p, i) => ({
      id:        `message_${i + 1}`,
      type:      'message',
      value:     typeof p === 'string' ? p : p.positioning,
      hypothesis: null,
    })),
  };
}

function buildTestPlanSkeleton({ backupPains, positioningOptions, angles }) {
  return {
    dimensions:  buildTestDimensions({ backupPains, positioningOptions, angles }),
    hypotheses:  [],    // AI fills full hypotheses
    priority:    'angles_first', // test angles before messages
    successMetric: 'CTR > 2% and CPC < target',
    minSampleSize: 1000,
  };
}

module.exports = { buildTestPlanSkeleton, buildTestDimensions };
