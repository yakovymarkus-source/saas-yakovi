'use strict';
/**
 * strategy/engines/positioning-engine.js
 * Module 3 (Positioning Engine): Competitor mapping, gap matching, position scoring.
 * Pure logic. AI generates options in claude-strategy-engine.js.
 */

// ── Competitor → Message mapping ──────────────────────────────────────────────
function mapCompetitors(competitorMessages) {
  return competitorMessages.map(c => ({
    name:        c.name,
    domain:      c.domain,
    mainAngle:   c.messages[0] || '',
    allAngles:   c.messages,
    platforms:   c.platforms,
    priority:    c.priority,
    weakness:    null, // AI will identify
  }));
}

// ── Find angles NOT used by competitors ──────────────────────────────────────
function findOpenAngles(competitorMessages, opportunityZones) {
  const usedAngles = [...new Set(competitorMessages.flatMap(c => c.messages || []))];
  // Opportunity zones are potential open angles
  return opportunityZones.map(z => ({
    title:    z.title,
    type:     z.source || 'gap',
    priority: z.priority,
    usedBy:   0, // not used by competitors
  }));
}

// ── Position Scoring (for AI-generated options) ───────────────────────────────
function scorePositioning({ clarity = 50, differentiation = 50, relevance = 50, marketFit = 50 }) {
  return Math.round(
    clarity         * 0.30 +
    differentiation * 0.35 +
    relevance       * 0.20 +
    marketFit       * 0.15
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
function runPositioningEngine({ competitorMessages, opportunityZones, wornOutMessages }) {
  const mappedCompetitors = mapCompetitors(competitorMessages);
  const usedAngles        = [...new Set(competitorMessages.flatMap(c => c.messages || []))];
  const openAngles        = findOpenAngles(competitorMessages, opportunityZones);
  const highGaps          = opportunityZones.filter(z => z.priority === 'high');

  return {
    mappedCompetitors,
    usedAngles,
    wornOutMessages,
    openAngles,
    highGaps,
    // Filled by AI:
    positioningOptions:  [],
    selectedPositioning: null,
    whyUs:               null,
    gapUsed:             null,
    positionScore:       0,
  };
}

module.exports = { runPositioningEngine, scorePositioning, mapCompetitors };
