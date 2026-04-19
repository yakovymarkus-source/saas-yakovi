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

/**
 * Red flag detection: contradictory data, thin coverage, or suspicious patterns.
 */
function detectRedFlags(signals, entities = []) {
  const flags = [];

  // 1. Same topic appearing as both desire and fear
  const desireTexts = signals.filter(s => s.type === 'desire').map(s => s.text.toLowerCase());
  const fearTexts   = signals.filter(s => s.type === 'fear').map(s => s.text.toLowerCase());
  let contradictions = 0;
  outer: for (const d of desireTexts) {
    const dWords = d.split(/\s+/).filter(w => w.length > 4);
    for (const f of fearTexts) {
      const fWords = f.split(/\s+/).filter(w => w.length > 4);
      const overlap = dWords.filter(w => fWords.includes(w));
      if (overlap.length >= 2) {
        contradictions++;
        if (contradictions >= 2) break outer;
      }
    }
  }
  if (contradictions >= 2) {
    flags.push({ type: 'contradictory_sentiment', description: 'כמה נושאים מופיעים גם כרצון וגם כפחד — ייתכן עמימות בנישה', severity: 'medium' });
  }

  // 2. Thin coverage — missing critical signal types
  const groups      = groupByType(signals);
  const emptyCore   = ['pain', 'fear', 'desire'].filter(t => groups[t].length === 0);
  if (emptyCore.length >= 2) {
    flags.push({ type: 'thin_coverage', description: `חסרים סוגי אותות: ${emptyCore.join(', ')}`, severity: 'high' });
  }

  // 3. All signals have suspiciously identical confidence
  const confidences = signals.map(s => s.confidence || 50);
  const allSame     = confidences.every(c => c === confidences[0]);
  if (signals.length > 5 && allSame) {
    flags.push({ type: 'uniform_confidence', description: 'כל האותות עם אותה רמת ביטחון — ייתכן עיצוב מחדש של נתונים', severity: 'low' });
  }

  // 4. Duplicate entity names across the entity list
  if (entities.length > 0) {
    const firstWords = entities.map(e => (e.name || '').toLowerCase().split(/\s+/)[0]);
    const dupes      = firstWords.filter((w, i) => w && firstWords.indexOf(w) !== i);
    if (dupes.length > 0) {
      flags.push({ type: 'duplicate_entities', description: `ייתכנו כפילויות בין מתחרים: ${[...new Set(dupes)].join(', ')}`, severity: 'low' });
    }
  }

  return flags;
}

function analyzeAvatar(signals, plan, entities = []) {
  const groups     = groupByType(signals);
  const saturation = checkSaturation(signals);
  const diversity  = checkDiversity(groups);
  const quality    = qualityScore(signals, plan);
  const top        = topSignals(groups);

  const isLowConfidence = signals.length < plan.minSignalsRequired;
  const redFlags        = detectRedFlags(signals, entities);

  return {
    groups,
    topSignals:       top,
    saturation,
    diversity,
    qualityScore:     quality,
    isLowConfidence,
    redFlags,
    totalSignals:     signals.length,
    segments:         [...new Set(signals.map(s => s.segment).filter(Boolean))],
    corePains:        top.pain?.map(s => s.text)       || [],
    coreFears:        top.fear?.map(s => s.text)       || [],
    coreDesires:      top.desire?.map(s => s.text)     || [],
    languagePatterns: top.language?.map(s => s.text)   || [],
  };
}

module.exports = { analyzeAvatar, groupByType, checkSaturation, qualityScore, detectRedFlags };
