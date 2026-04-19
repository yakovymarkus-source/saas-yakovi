'use strict';
/**
 * strategy/engines/product-engine.js
 * Module 2 (Product Engine): Pain scoring, product design, viability check.
 * Pure logic. AI call for product design is in claude-strategy-engine.js.
 */

// ── Pain Scoring ───────────────────────────────────────────────────────────────
// Score = Frequency(0-25) + Intensity(0-25) + MonetizationSignal(0-25) + FailedAttempts(baseline 15) + UrgencyBonus(0-10)
const MONETIZATION_MAP = {
  pain: 25, frustration: 22, fear: 18, desire: 12, trigger: 10, language: 5, belief: 8,
};

function scorePain(signal) {
  const frequencyScore   = Math.min(25, (signal.frequency || 1) * 8);
  const intensityScore   = Math.round((signal.confidence || 50) / 100 * 25);
  const monetization     = MONETIZATION_MAP[signal.type] || 10;
  const failedAttempts   = 15; // baseline — AI will enrich
  const urgency          = signal.type === 'frustration' || signal.type === 'fear' ? 10 : 5;
  return Math.min(100, frequencyScore + intensityScore + monetization + failedAttempts + urgency);
}

function selectTopPains(painCandidates, max = 5) {
  return painCandidates
    .map(p => ({ ...p, painScore: scorePain(p) }))
    .sort((a, b) => b.painScore - a.painScore)
    .slice(0, max);
}

// ── Product Type Heuristic ─────────────────────────────────────────────────────
function heuristicProductType(selectedPain) {
  const score    = selectedPain.painScore;
  const type     = selectedPain.type;
  const textLen  = (selectedPain.text || '').length;

  if (type === 'frustration' && score > 70) return 'service';
  if (type === 'pain'        && score > 75) return 'coaching';
  if (type === 'fear'        && score > 60) return 'course';
  if (textLen > 80)                         return 'saas';
  return 'course';
}

// ── Viability Pre-check (programmatic) ────────────────────────────────────────
function preCheckViability({ scoredPains, competitorMessages, opportunityZones }) {
  const checks = {
    hasPain:           scoredPains.length > 0,
    hasCompetitors:    competitorMessages.length > 0,          // someone already sells → market exists
    hasOpportunity:    opportunityZones.length > 0,
    painStrong:        scoredPains[0]?.painScore >= 50,
    multipleSignals:   scoredPains.reduce((s, p) => s + (p.frequency || 1), 0) >= 3,
  };
  const passed = Object.values(checks).filter(Boolean).length;
  return { checks, viabilityScore: Math.round((passed / Object.keys(checks).length) * 100) };
}

// ── Main ───────────────────────────────────────────────────────────────────────
function runProductEngine({ painCandidates, competitorMessages, opportunityZones }) {
  const scoredPains  = selectTopPains(painCandidates);
  const selectedPain = scoredPains[0] || null;
  const backupPains  = scoredPains.slice(1, 3);
  const viability    = preCheckViability({ scoredPains, competitorMessages, opportunityZones });
  const productType  = selectedPain ? heuristicProductType(selectedPain) : null;

  return {
    painCandidates:    scoredPains,
    selectedPain:      selectedPain?.text || null,
    selectedPainScore: selectedPain?.painScore || 0,
    backupPains:       backupPains.map(p => p.text),
    productType,                    // heuristic; AI may override
    viabilityScore:    viability.viabilityScore,
    viabilityChecks:   viability.checks,
    // Fields filled by AI:
    outcome:           null,
    productStructure:  [],
  };
}

module.exports = { runProductEngine, scorePain, selectTopPains, preCheckViability };
