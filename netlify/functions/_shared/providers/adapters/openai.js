'use strict';

/**
 * providers/adapters/openai.js — OpenAI Chat Completions Adapter
 *
 * Capabilities: ad_copy, campaign_strategy, analysis_summary,
 *               issue_explanation, iteration_advice
 *
 * Uses native fetch (Node 18+). No SDK dependency.
 * JSON mode enforced via response_format: { type: 'json_object' }.
 *
 * Environment:
 *   OPENAI_API_KEY   — required
 *   OPENAI_MODEL     — optional, default: gpt-4o-mini
 *   OPENAI_TIMEOUT   — optional ms, default: 25000
 */

const { AdapterError, CAPABILITIES } = require('../contract');

const SUPPORTED_CAPABILITIES = [
  CAPABILITIES.AD_COPY,
  CAPABILITIES.CAMPAIGN_STRATEGY,
  CAPABILITIES.ANALYSIS_SUMMARY,
  CAPABILITIES.ISSUE_EXPLANATION,
  CAPABILITIES.ITERATION_ADVICE,
];

const BASE_URL    = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL   = 'gpt-4o-mini';
const DEFAULT_TIMEOUT = 25_000;

// ── Adapter implementation ────────────────────────────────────────────────────

const OpenAIAdapter = {
  getName()         { return 'openai'; },
  getCapabilities() { return SUPPORTED_CAPABILITIES; },
  getDefaultModel() { return process.env.OPENAI_MODEL || DEFAULT_MODEL; },
  getTimeout()      { return Number(process.env.OPENAI_TIMEOUT || DEFAULT_TIMEOUT); },

  validateInput(prompt) {
    if (!prompt || typeof prompt.system !== 'string' || !prompt.system.trim()) {
      throw new AdapterError('INVALID_INPUT', 'OpenAI prompt must have a non-empty system string');
    }
    if (!prompt || typeof prompt.user !== 'string' || !prompt.user.trim()) {
      throw new AdapterError('INVALID_INPUT', 'OpenAI prompt must have a non-empty user string');
    }
  },

  async execute(capability, prompt, options = {}) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new AdapterError('PROVIDER_NOT_CONFIGURED', 'OPENAI_API_KEY is not set');

    const model   = options.model   || this.getDefaultModel();
    const timeout = options.timeout || this.getTimeout();

    const body = {
      model,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user',   content: prompt.user   },
      ],
      response_format: { type: 'json_object' },
      temperature:     0.7,
      max_tokens:      prompt.maxTokens || 1500,
    };

    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), timeout);

    let response;
    try {
      response = await fetch(BASE_URL, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body:   JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (err.name === 'AbortError') throw new AdapterError('TIMEOUT', `OpenAI request timed out after ${timeout}ms`);
      throw new AdapterError('NETWORK_ERROR', `OpenAI network error: ${err.message}`);
    } finally {
      clearTimeout(timer);
    }

    const raw = await response.json().catch(() => null);

    if (!response.ok) {
      const msg = raw?.error?.message || `HTTP ${response.status}`;
      const code = response.status === 429 ? 'RATE_LIMITED'
                 : response.status === 401 ? 'PROVIDER_NOT_CONFIGURED'
                 : 'PROVIDER_ERROR';
      throw new AdapterError(code, `OpenAI error: ${msg}`);
    }

    // Attach usage + model to raw so router can extract them
    raw._model = raw.model || model;
    raw._usage = raw.usage ? {
      promptTokens:     raw.usage.prompt_tokens,
      completionTokens: raw.usage.completion_tokens,
      totalTokens:      raw.usage.total_tokens,
    } : null;

    return raw;
  },

  parseResponse(raw, capability) {
    const text = raw?.choices?.[0]?.message?.content;
    if (!text) throw new AdapterError('PARSE_ERROR', 'OpenAI returned empty content');

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new AdapterError('PARSE_ERROR', `OpenAI response is not valid JSON: ${text.slice(0, 200)}`);
    }

    // Validate that the parsed object has minimum expected shape per capability
    return validateCapabilityShape(capability, parsed);
  },
};

// ── Per-capability shape validation ──────────────────────────────────────────

function validateCapabilityShape(capability, data) {
  switch (capability) {
    case CAPABILITIES.AD_COPY:
      if (!Array.isArray(data.variants)) throw new AdapterError('PARSE_ERROR', 'ad_copy response missing variants array');
      return data;

    case CAPABILITIES.ANALYSIS_SUMMARY:
      if (!data.main_finding) throw new AdapterError('PARSE_ERROR', 'analysis_summary missing main_finding');
      return data;

    case CAPABILITIES.ISSUE_EXPLANATION:
      if (!data.title && !data.explanation) throw new AdapterError('PARSE_ERROR', 'issue_explanation missing title/explanation');
      return data;

    case CAPABILITIES.ITERATION_ADVICE:
      if (!data.action) throw new AdapterError('PARSE_ERROR', 'iteration_advice missing action field');
      return data;

    case CAPABILITIES.CAMPAIGN_STRATEGY:
      if (!data.strategy) throw new AdapterError('PARSE_ERROR', 'campaign_strategy missing strategy field');
      return data;

    default:
      return data;
  }
}

module.exports = OpenAIAdapter;
