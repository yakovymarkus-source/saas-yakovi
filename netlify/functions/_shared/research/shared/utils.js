'use strict';
/**
 * Shared utility functions for the research agent.
 */

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function chunk(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

function truncate(str, maxLen = 200) {
  if (!str || str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

function safeJson(str, fallback = null) {
  try { return typeof str === 'string' ? JSON.parse(str) : str; }
  catch { return fallback; }
}

function calcConfidence(signals) {
  if (!signals?.length) return 0;
  return Math.round(signals.reduce((s, x) => s + (x.confidence || 50), 0) / signals.length);
}

function dedupe(arr, keyFn) {
  const seen = new Set();
  return arr.filter(item => {
    const k = keyFn(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Retry an async fn up to maxAttempts times with exponential backoff */
async function withRetry(fn, maxAttempts = 2, delayMs = 1000) {
  let lastErr;
  for (let i = 0; i < maxAttempts; i++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      if (i < maxAttempts - 1) await sleep(delayMs * (i + 1));
    }
  }
  throw lastErr;
}

module.exports = { sleep, chunk, truncate, safeJson, calcConfidence, dedupe, withRetry };
