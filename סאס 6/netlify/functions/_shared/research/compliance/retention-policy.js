'use strict';
/**
 * Data retention policy for research data.
 * Cache: never deleted, marked stale after 30 days.
 * Job history: kept for 365 days.
 */

const CACHE_TTL_MS  = 30  * 24 * 60 * 60 * 1000;
const STALE_TTL_MS  = 90  * 24 * 60 * 60 * 1000;
const JOB_TTL_DAYS  = 365;

function getStaleAfterDate() {
  return new Date(Date.now() + CACHE_TTL_MS).toISOString();
}

function isStale(updatedAt) {
  return Date.now() - new Date(updatedAt).getTime() > CACHE_TTL_MS;
}

function isExpired(updatedAt) {
  return Date.now() - new Date(updatedAt).getTime() > STALE_TTL_MS;
}

/**
 * Mark stale cache entries (never deletes rows, only sets is_stale=true).
 * Run periodically via scheduled function.
 */
async function markStaleEntries(supabase) {
  const cutoff = new Date(Date.now() - CACHE_TTL_MS).toISOString();
  const { data, error } = await supabase
    .from('research_cache')
    .update({ is_stale: true })
    .lt('updated_at', cutoff)
    .eq('is_stale', false)
    .select('id');
  if (error) console.warn('[retention] markStale error:', error.message);
  return data?.length || 0;
}

module.exports = { markStaleEntries, isStale, isExpired, getStaleAfterDate, CACHE_TTL_MS, JOB_TTL_DAYS };
