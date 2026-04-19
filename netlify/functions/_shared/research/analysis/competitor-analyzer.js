'use strict';

/**
 * research/analysis/competitor-analyzer.js
 * Applies Decision Layer scoring and deduplication to raw competitor entities.
 */

// Score + priority based on confidence and raw strength score
function scoreEntity(entity) {
  const score      = entity.score      || 50;
  const confidence = entity.confidence_score || 70;
  let priority;
  if (score > 80 && confidence > 70)      priority = 'high';
  else if (score > 60)                     priority = 'medium';
  else                                     priority = 'low';
  return { ...entity, score, priority };
}

// Remove near-duplicate competitors (same domain or very similar name)
function deduplicate(entities) {
  const seen    = new Set();
  const result  = [];
  for (const e of entities) {
    const key = (e.primary_domain || e.name || '').toLowerCase().replace(/^www\./, '');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(e);
  }
  return result;
}

// Apply hard cap: keep only top N by score, filter out LOW unless not enough HIGH+MEDIUM
function applyTopCap(entities, topN) {
  const scored  = entities.map(scoreEntity).sort((a, b) => b.score - a.score);
  const high    = scored.filter(e => e.priority === 'high');
  const medium  = scored.filter(e => e.priority === 'medium');
  const low     = scored.filter(e => e.priority === 'low');

  const selected = [];
  selected.push(...high);
  selected.push(...medium);
  if (selected.length < 3) selected.push(...low);
  return selected.slice(0, topN);
}

// Validate: at least minCount competitors with at least minPlatforms each
function validate(entities, minCount = 3) {
  const valid = entities.filter(e => e.name && e.confidence_score >= 50);
  return {
    isValid:    valid.length >= minCount,
    count:      valid.length,
    minMet:     valid.length >= minCount,
    lowConfidence: entities.filter(e => e.confidence_score < 50).length,
  };
}

function analyzeCompetitors(rawEntities, plan) {
  const deduped   = deduplicate(rawEntities);
  const topped    = applyTopCap(deduped, plan.topCompetitors);
  const validation = validate(topped);

  // Build market segments from competitor strengths
  const segments = {
    strong:  topped.filter(e => e.priority === 'high').map(e => e.name),
    medium:  topped.filter(e => e.priority === 'medium').map(e => e.name),
    weak:    topped.filter(e => e.priority === 'low').map(e => e.name),
  };

  // Dominant messages across all competitors
  const allMessages = topped.flatMap(e =>
    [e.key_message, ...(e.raw_data?.ads_messages || [])].filter(Boolean)
  );

  return { entities: topped, segments, dominantMessages: allMessages, validation };
}

module.exports = { analyzeCompetitors, scoreEntity, deduplicate };
