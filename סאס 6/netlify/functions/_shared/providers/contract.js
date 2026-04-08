'use strict';

/**
 * providers/contract.js — Provider Interface Contract
 *
 * Every provider adapter MUST implement this interface.
 * validateAdapter() is called at registration time — fail fast, not at request time.
 *
 * StandardResult shape returned by all adapters:
 *
 *   Success:
 *   {
 *     ok:         true,
 *     provider:   'openai',
 *     capability: 'ad_copy',
 *     model:      'gpt-4o-mini',
 *     content:    { ... }        ← capability-specific, already parsed + normalized
 *     usage:      { promptTokens, completionTokens, totalTokens }
 *     latency_ms: number,
 *   }
 *
 *   Failure:
 *   {
 *     ok:           false,
 *     provider:     'openai',
 *     capability:   'ad_copy',
 *     error:        'PROVIDER_ERROR' | 'PARSE_ERROR' | 'TIMEOUT' | 'PROVIDER_NOT_CONFIGURED',
 *     errorMessage: string,
 *     latency_ms:   number,
 *   }
 *
 * Required adapter methods:
 *
 *   getName()             → string                         provider identifier
 *   getCapabilities()     → string[]                       list of supported task types
 *   validateInput(payload)→ void (throws AdapterError on invalid)
 *   execute(capability, prompt, options) → raw API response
 *   parseResponse(raw, capability) → StandardResult.content (throws on parse failure)
 *
 * Optional:
 *   getDefaultModel()     → string
 *   getTimeout()          → number (ms)
 */

class AdapterError extends Error {
  constructor(code, message) {
    super(message);
    this.name  = 'AdapterError';
    this.code  = code;
  }
}

/**
 * validateAdapter(adapter)
 * Throws if the adapter is missing required methods.
 * Called once at registration.
 */
function validateAdapter(adapter) {
  const required = ['getName', 'getCapabilities', 'validateInput', 'execute', 'parseResponse'];
  for (const method of required) {
    if (typeof adapter[method] !== 'function') {
      throw new AdapterError(
        'INVALID_ADAPTER',
        `Adapter is missing required method: ${method}`,
      );
    }
  }
  const name  = adapter.getName();
  const caps  = adapter.getCapabilities();
  if (typeof name !== 'string' || !name) throw new AdapterError('INVALID_ADAPTER', 'getName() must return a non-empty string');
  if (!Array.isArray(caps) || caps.length === 0) throw new AdapterError('INVALID_ADAPTER', 'getCapabilities() must return a non-empty array');
}

/**
 * buildStandardResult(fields) — constructs a typed StandardResult.
 * Use inside adapters' parseResponse() to guarantee shape.
 */
function buildStandardResult({ ok, provider, capability, model, content, usage, latency_ms, error, errorMessage }) {
  if (ok) {
    return { ok: true, provider, capability, model: model || null, content, usage: usage || null, latency_ms: latency_ms || 0 };
  }
  return { ok: false, provider, capability, error: error || 'UNKNOWN', errorMessage: errorMessage || 'Unknown error', latency_ms: latency_ms || 0 };
}

/**
 * CAPABILITIES — canonical list of all task types in the system.
 * Provider adapters declare which subset they support via getCapabilities().
 */
const CAPABILITIES = Object.freeze({
  AD_COPY:            'ad_copy',
  CAMPAIGN_STRATEGY:  'campaign_strategy',
  ANALYSIS_SUMMARY:   'analysis_summary',
  ISSUE_EXPLANATION:  'issue_explanation',
  ITERATION_ADVICE:   'iteration_advice',
  LANDING_PAGE:       'landing_page',
  IMAGE_GENERATION:   'image_generation',
});

module.exports = { AdapterError, validateAdapter, buildStandardResult, CAPABILITIES };
