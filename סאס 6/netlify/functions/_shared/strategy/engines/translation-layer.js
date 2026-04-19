'use strict';
/**
 * strategy/engines/translation-layer.js
 * Module 1: Converts raw research output → structured decision inputs.
 * Pure logic — no AI calls, no DB access.
 * RULE: No assumptions. Missing data → explicit null/empty.
 */

function translateResearch({ avatar_signals, competitors = [], gaps = [], patterns = [] }) {
  const groups   = avatar_signals?.groups || {};
  const painSigs = [...(groups.pain || []), ...(groups.frustration || [])];
  const fearSigs = groups.fear    || [];
  const desireSigs= groups.desire || [];

  // ── Pain Candidates ─────────────────────────────────────────────────────────
  const painCandidates = painSigs
    .slice(0, 10)
    .map(s => ({
      text:       s.text,
      type:       s.type || 'pain',
      frequency:  s.frequency || 1,
      confidence: s.confidence || 50,
      segment:    s.segment   || null,
    }));

  // ── Competitor messages ──────────────────────────────────────────────────────
  const competitorMessages = competitors.map(c => ({
    name:      c.name,
    domain:    c.primary_domain || '',
    priority:  c.priority || 'medium',
    messages:  Array.isArray(c.key_messages) ? c.key_messages : (c.key_message ? [c.key_message] : []),
    platforms: c.ad_platforms || c.platforms || [],
    adCount:   c.ads_count || 0,
    confidence:c.confidence || 50,
  }));

  // ── Worn-out messages (used by 2+ competitors) ───────────────────────────────
  const msgCount = {};
  competitors.forEach(c => {
    const msgs = Array.isArray(c.key_messages) ? c.key_messages : (c.key_message ? [c.key_message] : []);
    msgs.forEach(m => { msgCount[m] = (msgCount[m] || 0) + 1; });
  });
  const wornOutMessages = Object.entries(msgCount)
    .filter(([, n]) => n >= 2).map(([m]) => m);

  // ── Opportunity zones (gaps + patterns with high/medium priority) ────────────
  const opportunityZones = [
    ...gaps.filter(g => ['high','medium'].includes(g.priority)).map(g => ({ ...g, source: 'gap' })),
    ...patterns.filter(p => p.priority === 'high').map(p => ({ ...p, source: 'pattern' })),
  ];

  return {
    painCandidates,
    fearSignals:      fearSigs.slice(0, 5).map(s => s.text),
    desireSignals:    desireSigs.slice(0, 5).map(s => s.text),
    languagePatterns: avatar_signals?.languagePatterns || [],
    segments:         avatar_signals?.segments || [],
    competitorMessages,
    wornOutMessages,
    opportunityZones,
    totalSignals:     avatar_signals?.totalSignals || painSigs.length + fearSigs.length + desireSigs.length,
    researchConfidence: avatar_signals?.qualityScore || 50,
  };
}

module.exports = { translateResearch };
