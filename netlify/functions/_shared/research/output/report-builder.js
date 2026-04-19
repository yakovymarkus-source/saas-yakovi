'use strict';

/**
 * research/output/report-builder.js
 * Assembles the final Output Contract JSON from all pipeline results.
 * Format is fixed — every field is required.
 */

function buildReport({
  jobId, userId, niche, depthLevel,
  entities, avatarAnalysis, adsIntelligence,
  patterns, gaps, opportunities, recommendations,
  dataQuality, aiCallsMade, generationMs, sourcesUsed,
}) {
  const now = new Date().toISOString();

  // Market Map
  const market_map = {
    top_competitors: entities.map(e => ({
      name:          e.name,
      domain:        e.primary_domain || '',
      description:   e.description    || '',
      main_offering: e.main_offering  || '',
      key_message:   e.key_message    || '',
      platforms:     e.platforms      || [],
      strength:      e.priority       || 'medium',
      score:         e.score          || 50,
      confidence:    e.confidence_score || 70,
    })),
    market_segments: entities.reduce((acc, e) => {
      if (!acc.includes(e.priority)) acc.push(e.priority);
      return acc;
    }, []).map(p => ({ level: p, competitors: entities.filter(e => e.priority === p).map(e => e.name) })),
    dominant_messages:  entities.map(e => e.key_message).filter(Boolean),
    common_offers:      adsIntelligence?.common_offers || [],
    winning_angles:     adsIntelligence?.winning_angles || [],
    top_ctas:           adsIntelligence?.top_ctas || [],
    ad_insights:        adsIntelligence?.ad_insights || '',
  };

  // Avatar Profile
  const avatar = {
    segments:          avatarAnalysis.segments || [],
    core_pains:        avatarAnalysis.corePains || [],
    fears:             avatarAnalysis.coreFears || [],
    desires:           avatarAnalysis.coreDesires || [],
    language_patterns: avatarAnalysis.languagePatterns || [],
    frustrations:      (avatarAnalysis.topSignals?.frustration || []).map(s => s.text),
    triggers:          (avatarAnalysis.topSignals?.trigger     || []).map(s => s.text),
    quality_score:     avatarAnalysis.qualityScore || 0,
    total_signals:     avatarAnalysis.totalSignals || 0,
    is_low_confidence: avatarAnalysis.isLowConfidence || false,
  };

  // Insights
  const insights = {
    patterns,
    gaps,
    opportunities,
    summary: {
      total:        patterns.length + gaps.length + opportunities.length,
      high_priority: [...patterns, ...gaps, ...opportunities].filter(i => i.priority === 'high').length,
      actionable:    [...gaps, ...opportunities].filter(i => i.action_required).length,
    },
  };

  // Confidence governance: only show insights >= 50
  const filteredPatterns     = patterns.filter(i => i.confidence >= 50);
  const filteredGaps         = gaps.filter(i => i.confidence >= 50);
  const filteredOpportunities= opportunities.filter(i => i.confidence >= 50);

  insights.patterns     = filteredPatterns;
  insights.gaps         = filteredGaps;
  insights.opportunities= filteredOpportunities;

  return {
    job_id:       jobId,
    user_id:      userId,
    niche,
    depth_level:  depthLevel,
    generated_at: now,
    market_map,
    avatar,
    insights,
    recommendations: recommendations || [],
    meta: {
      data_quality_score: dataQuality,
      confidence_score:   Math.round((dataQuality + (avatarAnalysis.qualityScore || 0)) / 2),
      entities_count:     entities.length,
      signals_count:      avatarAnalysis.totalSignals || 0,
      ai_calls_made:      aiCallsMade,
      generation_ms:      generationMs,
      sources_used:       sourcesUsed || ['claude_researcher'],
    },
  };
}

module.exports = { buildReport };
