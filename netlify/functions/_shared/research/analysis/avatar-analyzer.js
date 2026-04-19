'use strict';

/**
 * research/analysis/avatar-analyzer.js
 * Groups and scores avatar signals. Applies saturation detection.
 */

// Group signals by type
function groupByType(signals) {
  const groups = { pain: [], fear: [], desire: [], frustration: [], trigger: [], language: [], belief: [] };
  for (const s of signals) {
    const t = s.type || 'pain';
    if (groups[t]) groups[t].push(s);
  }
  return groups;
}

// Saturation check: if >70% of new signals repeat existing patterns → stop collecting
function checkSaturation(signals) {
  const texts   = signals.map(s => s.text.toLowerCase().slice(0, 40));
  const unique  = new Set(texts);
  const saturationPct = signals.length > 0
    ? Math.round(((signals.length - unique.size) / signals.length) * 100)
    : 0;
  return { isSaturated: saturationPct >= 70, saturationPct, uniqueCount: unique.size };
}

// Diversity check: at least 2-3 signal types present
function checkDiversity(groups) {
  const populated = Object.entries(groups).filter(([, arr]) => arr.length > 0).map(([k]) => k);
  const hasPain    = populated.includes('pain')    || populated.includes('frustration');
  const hasFear    = populated.includes('fear');
  const hasDesire  = populated.includes('desire');
  return {
    isValid: populated.length >= 2 && hasPain,
    populated,
    missingTypes: ['pain', 'fear', 'desire'].filter(t => !populated.includes(t)),
  };
}

// Quality score: (quantity + repetition + diversity) / 3
function qualityScore(signals, plan) {
  const qty        = Math.min(100, Math.round((signals.length / plan.minSignalsRequired) * 100));
  const saturation = checkSaturation(signals);
  const repetition = saturation.saturationPct;
  const diversity  = checkDiversity(groupByType(signals));
  const divScore   = diversity.isValid ? 80 : 40;
  return Math.round((qty + repetition + divScore) / 3);
}

// Top signals per type (by confidence × frequency)
function topSignals(groups, perType = 5) {
  const result = {};
  for (const [type, arr] of Object.entries(groups)) {
    result[type] = arr
      .sort((a, b) => (b.confidence * (b.frequency || 1)) - (a.confidence * (a.frequency || 1)))
      .slice(0, perType);
  }
  return result;
}

function analyzeAvatar(signals, plan) {
  const groups     = groupByType(signals);
  const saturation = checkSaturation(signals);
  const diversity  = checkDiversity(groups);
  const quality    = qualityScore(signals, plan);
  const top        = topSignals(groups);

  const isLowConfidence = signals.length < plan.minSignalsRequired;

  return {
    groups,
    topSignals:      top,
    saturation,
    diversity,
    qualityScore:    quality,
    isLowConfidence,
    totalSignals:    signals.length,
    segments:        [...new Set(signals.map(s => s.segment).filter(Boolean))],
    corePains:       top.pain?.map(s => s.text)        || [],
    coreFears:       top.fear?.map(s => s.text)        || [],
    coreDesires:     top.desire?.map(s => s.text)      || [],
    languagePatterns: top.language?.map(s => s.text)  || [],
  };
}

module.exports = { analyzeAvatar, groupByType, checkSaturation, qualityScore };
