'use strict';

/**
 * providers/config.js — External Capability→Provider Configuration
 *
 * Determines which provider handles each capability.
 * Priority (highest to lowest):
 *   1. AI_PROVIDER_CONFIG env var (JSON, overrides everything)
 *   2. Per-capability env vars  (e.g. PROVIDER_AD_COPY=openai)
 *   3. DEFAULT_CAPABILITY_MAP   (hardcoded sensible defaults)
 *
 * To add a new provider for a capability:
 *   Set AI_PROVIDER_CONFIG={"ad_copy":"gemini"} in Netlify env
 *   AND register a 'gemini' adapter in the registry.
 *
 * Zero hardcoding of provider names inside business logic.
 */

const { CAPABILITIES } = require('./contract');

// ── Default routing table ─────────────────────────────────────────────────────
// Change these defaults by setting env vars — never edit this file.

const DEFAULT_CAPABILITY_MAP = {
  // ── Text / analysis — OpenAI ────────────────────────────────────────────────
  [CAPABILITIES.AD_COPY]:           'openai',
  [CAPABILITIES.CAMPAIGN_STRATEGY]: 'openai',
  [CAPABILITIES.ANALYSIS_SUMMARY]:  'openai',
  [CAPABILITIES.ISSUE_EXPLANATION]: 'openai',
  [CAPABILITIES.ITERATION_ADVICE]:  'openai',
  // ── Visual / structured long-form — Claude (Anthropic) ──────────────────────
  [CAPABILITIES.LANDING_PAGE]:      'claude',
  [CAPABILITIES.AD_CREATIVE]:       'claude',
  // ── Image generation (future) ───────────────────────────────────────────────
  [CAPABILITIES.IMAGE_GENERATION]:  'nano_banana',
};

// ── Config loader (called once per request — cheap, no DB) ────────────────────

let _cachedConfig = null;

function loadConfig() {
  if (_cachedConfig) return _cachedConfig;

  let overrides = {};

  // 1. JSON blob override
  if (process.env.AI_PROVIDER_CONFIG) {
    try {
      overrides = JSON.parse(process.env.AI_PROVIDER_CONFIG);
    } catch {
      console.warn('[provider-config] AI_PROVIDER_CONFIG is not valid JSON — using defaults');
    }
  }

  // 2. Per-capability env var overrides (PROVIDER_<CAPABILITY_UPPER>=name)
  for (const capability of Object.values(CAPABILITIES)) {
    const envKey   = `PROVIDER_${capability.toUpperCase()}`;
    const envValue = process.env[envKey];
    if (envValue && typeof envValue === 'string') {
      overrides[capability] = envValue.toLowerCase().trim();
    }
  }

  const map = { ...DEFAULT_CAPABILITY_MAP, ...overrides };

  _cachedConfig = {
    /**
     * getProviderForCapability(capability) → string providerName
     * Throws if capability is unknown or has no mapping.
     */
    getProviderForCapability(capability) {
      const provider = map[capability];
      if (!provider) throw new Error(`No provider configured for capability: "${capability}"`);
      return provider;
    },

    /** Full map for inspection / logging */
    getFullMap() { return { ...map }; },
  };

  return _cachedConfig;
}

/** clearConfigCache() — call in tests to reset between test cases */
function clearConfigCache() { _cachedConfig = null; }

module.exports = { loadConfig, clearConfigCache, DEFAULT_CAPABILITY_MAP, CAPABILITIES };
