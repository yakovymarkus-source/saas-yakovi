'use strict';
/**
 * Google/SerpAPI collector stub.
 * Becomes active when SERPAPI_KEY env var is set.
 */

async function collectFromGoogle({ niche, queries = [], plan }) {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) return { entities: [], signals: [] };

  // TODO: Implement SerpAPI organic + ads search
  // Endpoint: https://serpapi.com/search.json
  // Queries: branded competitors, "<niche> best", "<niche> vs", "<niche> reviews"
  return { entities: [], signals: [] };
}

module.exports = { collectFromGoogle };
