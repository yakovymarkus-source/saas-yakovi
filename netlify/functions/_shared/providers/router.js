'use strict';

/**
 * providers/router.js — Capability-Based Router
 *
 * Routes tasks by CAPABILITY, never by provider name.
 *
 * The calling code says: "I need ad_copy"
 * The router determines: "ad_copy → openai" (from config)
 * The registry provides: the openai adapter instance
 * The adapter executes: the actual API call
 *
 * This is the ONLY place where capability→provider resolution happens.
 * No other file is allowed to contain "if provider === 'openai'" logic.
 */

const { AdapterError, buildStandardResult } = require('./contract');
const { loadConfig }    = require('./config');
const { getRegistry }   = require('./registry');

/**
 * route(capability, prompt, options)
 *
 * @param {string} capability  — one of CAPABILITIES.*
 * @param {object} prompt      — { system: string, user: string } from a prompt builder
 * @param {object} options     — { timeout?: number, model?: string }
 *
 * @returns {StandardResult}   — always returns, never throws
 *                               check .ok to determine success
 */
async function route(capability, prompt, options = {}) {
  const start = Date.now();
  let providerName = '(unknown)';

  try {
    // 1. Resolve provider from capability config
    const config = loadConfig();
    providerName = config.getProviderForCapability(capability);

    // 2. Get adapter from registry
    const registry = getRegistry();
    const adapter  = registry.get(providerName);

    // 3. Validate input
    adapter.validateInput(prompt);

    // 4. Execute
    const raw = await adapter.execute(capability, prompt, options);

    // 5. Parse + normalize
    const content = adapter.parseResponse(raw, capability);

    return buildStandardResult({
      ok:         true,
      provider:   providerName,
      capability,
      model:      raw._model || (typeof adapter.getDefaultModel === 'function' ? adapter.getDefaultModel() : null),
      content,
      usage:      raw._usage || null,
      latency_ms: Date.now() - start,
    });

  } catch (err) {
    const isAdapterErr = err instanceof AdapterError;
    const errorCode = isAdapterErr ? err.code : (err.code || 'PROVIDER_ERROR');

    return buildStandardResult({
      ok:           false,
      provider:     providerName,
      capability,
      error:        errorCode,
      errorMessage: err.message,
      latency_ms:   Date.now() - start,
    });
  }
}

module.exports = { route };
