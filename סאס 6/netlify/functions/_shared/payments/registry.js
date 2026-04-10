'use strict';

/**
 * registry.js — Payment provider registry.
 *
 * All available providers are registered here.
 * To add a new provider:
 *   1. Implement it under providers/<name>.js
 *   2. Register it below — that's all.
 */

const { GrowProvider }   = require('./providers/grow');
const { StripeProvider } = require('./providers/stripe');

const PROVIDERS = {
  grow:   new GrowProvider(),
  stripe: new StripeProvider(),
};

/**
 * Get a registered provider by name.
 * @param {string} name
 * @returns {import('./contract').PaymentProvider}
 */
function getProvider(name) {
  const provider = PROVIDERS[name];
  if (!provider) {
    throw new Error(
      `Unknown payment provider: "${name}". ` +
      `Available: ${Object.keys(PROVIDERS).join(', ')}`
    );
  }
  return provider;
}

/** @returns {string[]} */
function listProviders() {
  return Object.keys(PROVIDERS);
}

module.exports = { getProvider, listProviders };
