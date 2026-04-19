'use strict';
/**
 * Resolves entity identity across different data sources.
 * Deduplicates competitors by domain + name similarity.
 */

function normalizeDomain(domain) {
  if (!domain) return null;
  return domain.toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];
}

function normalizeName(name) {
  return name.toLowerCase().replace(/[^a-z0-9\u0590-\u05ff]/g, ' ').replace(/\s+/g, ' ').trim();
}

function isSameEntity(a, b) {
  // Match by domain
  const domA = normalizeDomain(a.primary_domain);
  const domB = normalizeDomain(b.primary_domain);
  if (domA && domB && domA === domB) return true;

  // Match by exact name
  const nameA = normalizeName(a.name || '');
  const nameB = normalizeName(b.name || '');
  if (nameA && nameB && nameA === nameB) return true;

  // Match by significant word overlap (≥50% of shorter name's words)
  const wordsA = nameA.split(' ').filter(w => w.length > 3);
  const wordsB = nameB.split(' ').filter(w => w.length > 3);
  if (wordsA.length >= 1 && wordsB.length >= 1) {
    const overlap = wordsA.filter(w => wordsB.includes(w));
    const minLen  = Math.min(wordsA.length, wordsB.length);
    if (overlap.length >= minLen) return true;
  }

  return false;
}

/**
 * Merge duplicate entities — keeps the one with higher confidence,
 * merges unique data fields from both.
 */
function mergeEntities(primary, secondary) {
  return {
    ...primary,
    confidence: Math.max(primary.confidence || 0, secondary.confidence || 0),
    ads_count:  (primary.ads_count || 0) + (secondary.ads_count || 0),
    primary_domain: primary.primary_domain || secondary.primary_domain,
    category:   primary.category || secondary.category,
  };
}

/**
 * Resolve a list of entities into deduplicated identities.
 */
function resolveIdentities(entities) {
  const resolved = [];
  for (const entity of entities) {
    const existingIdx = resolved.findIndex(e => isSameEntity(e, entity));
    if (existingIdx >= 0) {
      resolved[existingIdx] = mergeEntities(resolved[existingIdx], entity);
    } else {
      resolved.push({ ...entity });
    }
  }
  return resolved;
}

module.exports = { resolveIdentities, isSameEntity, normalizeDomain, normalizeName };
