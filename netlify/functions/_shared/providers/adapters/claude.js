'use strict';

/**
 * providers/adapters/claude.js — Anthropic Claude API Adapter
 *
 * Capabilities: landing_page, ad_creative
 *
 * Uses the Anthropic Messages API directly via fetch.
 * Note: This adapter calls the Anthropic cloud API as an *external provider*.
 *       It is not Claude Code itself — it's Claude used as an AI execution engine.
 *
 * Environment:
 *   ANTHROPIC_API_KEY  — required
 *   CLAUDE_MODEL       — optional, default: claude-haiku-4-5-20251001
 *   CLAUDE_TIMEOUT     — optional ms, default: 30000
 */

const { AdapterError, CAPABILITIES } = require('../contract');

const SUPPORTED_CAPABILITIES = [
  CAPABILITIES.LANDING_PAGE,
  CAPABILITIES.AD_CREATIVE,
];

const BASE_URL      = 'https://api.anthropic.com/v1/messages';
const API_VERSION   = '2023-06-01';
const DEFAULT_MODEL = 'claude-sonnet-4-6'; // Sonnet for high-quality landing page + visual generation
const DEFAULT_TIMEOUT = 22_000; // 22s — leaves headroom within Netlify's 26s function limit

const ClaudeAdapter = {
  getName()         { return 'claude'; },
  getCapabilities() { return SUPPORTED_CAPABILITIES; },
  getDefaultModel() { return process.env.CLAUDE_MODEL || DEFAULT_MODEL; },
  getTimeout()      { return Number(process.env.CLAUDE_TIMEOUT || DEFAULT_TIMEOUT); },

  validateInput(prompt) {
    if (!prompt?.system?.trim()) throw new AdapterError('INVALID_INPUT', 'Claude prompt must have a non-empty system string');
    if (!prompt?.user?.trim())   throw new AdapterError('INVALID_INPUT', 'Claude prompt must have a non-empty user string');
  },

  async execute(capability, prompt, options = {}) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new AdapterError('PROVIDER_NOT_CONFIGURED', 'ANTHROPIC_API_KEY is not set');

    const model   = options.model   || this.getDefaultModel();
    const timeout = options.timeout || this.getTimeout();

    // Anthropic Messages API format
    const body = {
      model,
      max_tokens: prompt.maxTokens || 2000,
      system:     prompt.system,
      messages:   [{ role: 'user', content: prompt.user }],
    };

    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), timeout);

    let response;
    try {
      response = await fetch(BASE_URL, {
        method:  'POST',
        headers: {
          'Content-Type':      'application/json',
          'x-api-key':         apiKey,
          'anthropic-version': API_VERSION,
        },
        body:   JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (err.name === 'AbortError') throw new AdapterError('TIMEOUT', `Claude request timed out after ${timeout}ms`);
      throw new AdapterError('NETWORK_ERROR', `Claude network error: ${err.message}`);
    } finally {
      clearTimeout(timer);
    }

    const raw = await response.json().catch(() => null);

    if (!response.ok) {
      const msg  = raw?.error?.message || `HTTP ${response.status}`;
      const code = response.status === 429 ? 'RATE_LIMITED'
                 : response.status === 401 ? 'PROVIDER_NOT_CONFIGURED'
                 : 'PROVIDER_ERROR';
      throw new AdapterError(code, `Claude error: ${msg}`);
    }

    raw._model = raw.model || model;
    raw._usage = raw.usage ? {
      promptTokens:     raw.usage.input_tokens,
      completionTokens: raw.usage.output_tokens,
      totalTokens:      (raw.usage.input_tokens || 0) + (raw.usage.output_tokens || 0),
    } : null;

    return raw;
  },

  parseResponse(raw, capability) {
    // Claude returns content as an array of content blocks
    const block = raw?.content?.find(b => b.type === 'text');
    const text  = block?.text;
    if (!text) throw new AdapterError('PARSE_ERROR', 'Claude returned empty content');

    // Extract JSON from the response (Claude may wrap it in markdown)
    const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/(\{[\s\S]*\})/);
    const jsonStr   = jsonMatch ? jsonMatch[1] : text;

    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      throw new AdapterError('PARSE_ERROR', `Claude response is not valid JSON: ${text.slice(0, 200)}`);
    }

    if (capability === CAPABILITIES.LANDING_PAGE) {
      if (!Array.isArray(parsed.sections)) {
        throw new AdapterError('PARSE_ERROR', 'landing_page response missing sections array');
      }
    }

    if (capability === CAPABILITIES.AD_CREATIVE) {
      if (!Array.isArray(parsed.creatives)) {
        throw new AdapterError('PARSE_ERROR', 'ad_creative response missing creatives array');
      }
    }

    return parsed;
  },
};

module.exports = ClaudeAdapter;
