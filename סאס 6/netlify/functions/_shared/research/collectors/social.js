'use strict';
/**
 * Social media collector stub (Reddit, forums, reviews).
 * Becomes active when REDDIT_CLIENT_ID env var is set.
 */

async function collectFromReddit({ niche, subreddits = [], plan }) {
  const clientId = process.env.REDDIT_CLIENT_ID;
  if (!clientId) return { signals: [] };

  // TODO: Implement Reddit API — search relevant subreddits for pain/desire signals
  // Endpoints: /r/<sub>/search, /search.json
  // Convert top-voted posts/comments to signals with type: pain/desire/frustration
  return { signals: [] };
}

async function collectFromSocial({ niche, entities = [], plan }) {
  const reddit = await collectFromReddit({ niche, plan });
  return { signals: [...reddit.signals] };
}

module.exports = { collectFromSocial, collectFromReddit };
