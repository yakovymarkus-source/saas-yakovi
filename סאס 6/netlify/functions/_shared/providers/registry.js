'use strict';

/**
 * providers/registry.js — Provider Registry
 *
 * Central store for all registered provider adapters.
 * Adapters are validated at registration time (fail fast).
 *
 * Usage:
 *   const registry = require('./registry');
 *   registry.register(new OpenAIAdapter());
 *   const adapter = registry.get('openai');
 *
 * The singleton instance is built once when this module is first required.
 * It automatically registers all known adapters.
 */

const { validateAdapter, AdapterError } = require('./contract');

class ProviderRegistry {
  constructor() {
    this._adapters    = new Map();   // name → adapter
    this._capabilities = new Map();  // capability → Set<providerName>
  }

  /**
   * register(adapter) — validates and stores the adapter.
   * Idempotent: re-registering the same name replaces the existing adapter.
   */
  register(adapter) {
    validateAdapter(adapter);
    const name = adapter.getName();
    this._adapters.set(name, adapter);

    for (const cap of adapter.getCapabilities()) {
      if (!this._capabilities.has(cap)) this._capabilities.set(cap, new Set());
      this._capabilities.get(cap).add(name);
    }
  }

  /**
   * get(providerName) → adapter
   * Throws if no adapter is registered for that name.
   */
  get(providerName) {
    const adapter = this._adapters.get(providerName);
    if (!adapter) {
      throw new AdapterError(
        'PROVIDER_NOT_REGISTERED',
        `No adapter registered for provider: "${providerName}". Register it in providers/registry.js.`,
      );
    }
    return adapter;
  }

  /** Returns true if the named provider is registered. */
  has(providerName) { return this._adapters.has(providerName); }

  /**
   * getProvidersForCapability(capability) → string[]
   * Returns all provider names that declared support for this capability.
   */
  getProvidersForCapability(capability) {
    return [...(this._capabilities.get(capability) || [])];
  }

  /** Debug helper — returns full capability→providers map */
  inspect() {
    const out = {};
    for (const [cap, names] of this._capabilities.entries()) {
      out[cap] = [...names];
    }
    return out;
  }
}

// ── Singleton — built lazily on first require ─────────────────────────────────

let _registry = null;

function getRegistry() {
  if (_registry) return _registry;

  _registry = new ProviderRegistry();

  // Register all known adapters.
  // To add a new provider: create its adapter and add one line here.
  try { _registry.register(require('./adapters/openai'));      } catch (e) { console.warn('[registry] openai adapter load failed:', e.message); }
  try { _registry.register(require('./adapters/claude'));      } catch (e) { console.warn('[registry] claude adapter load failed:', e.message); }
  try { _registry.register(require('./adapters/nano-banana')); } catch (e) { console.warn('[registry] nano-banana adapter load failed:', e.message); }

  return _registry;
}

module.exports = { getRegistry, ProviderRegistry };
