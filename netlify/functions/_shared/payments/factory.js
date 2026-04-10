'use strict';

/**
 * factory.js — Returns the currently active payment provider.
 *
 * The active provider is selected by the PAYMENT_PROVIDER env var.
 *
 * ── Switching provider in 3 steps ────────────────────────────────────────────
 *   Step 1: Implement providers/<new_provider>.js and register in registry.js
 *   Step 2: Set the new provider's env vars (e.g. NEW_PROVIDER_API_KEY=...)
 *   Step 3: Set PAYMENT_PROVIDER=<new_provider>
 *
 * That's it. No business logic changes needed.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { getProvider } = require('./registry');

/** @type {import('./contract').PaymentProvider|null} */
let _cached = null;

/**
 * Returns the active provider instance.
 * Cached after first call — provider doesn't change within a function invocation.
 *
 * @returns {import('./contract').PaymentProvider}
 */
function getActiveProvider() {
  if (_cached) return _cached;

  const name = (process.env.PAYMENT_PROVIDER || 'grow').toLowerCase().trim();
  const provider = getProvider(name);

  if (!provider.isConfigured()) {
    console.warn(
      `[payments/factory] Provider "${name}" is selected but isConfigured() returned false. ` +
      `Check that all required env vars are set.`
    );
  }

  console.info(`[payments/factory] Active payment provider: ${name}`);
  _cached = provider;
  return _cached;
}

/**
 * Reset cache — use in tests or after env change.
 */
function resetProviderCache() {
  _cached = null;
}

module.exports = { getActiveProvider, resetProviderCache };
