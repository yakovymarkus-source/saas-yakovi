'use strict';

/**
 * providers/adapters/openrouter.js — OpenRouter Gateway Adapter
 *
 * Routes requests through OpenRouter (https://openrouter.ai) to any model.
 * Supports automatic fallback if primary model fails.
 * Logs cost per call to ai_cost_log table.
 *
 * Environment:
 *   OPENROUTER_API_KEY  — required for OpenRouter calls
 *   ANTHROPIC_API_KEY   — required for direct Anthropic fallback (parachute)
 *
 * Model format: "provider/model-name" e.g. "anthropic/claude-sonnet-4-5"
 */

const { AdapterError, CAPABILITIES } = require('../contract');

const OPENROUTER_URL  = 'https://openrouter.ai/api/v1/chat/completions';
const ANTHROPIC_URL   = 'https://api.anthropic.com/v1/messages';
const API_VERSION     = '2023-06-01';

// OpenRouter pricing per 1M tokens (input/output) — updated periodically
const MODEL_PRICING = {
  'anthropic/claude-sonnet-4-5':          { in: 3.00,   out: 15.00  },
  'anthropic/claude-opus-4-5':            { in: 15.00,  out: 75.00  },
  'openai/gpt-4o':                        { in: 5.00,   out: 15.00  },
  'openai/gpt-4o-mini':                   { in: 0.15,   out: 0.60   },
  'meta-llama/llama-3.1-8b-instruct':     { in: 0.055,  out: 0.055  },
  'meta-llama/llama-3.1-70b-instruct':    { in: 0.39,   out: 0.39   },
  'google/gemini-pro-1.5':                { in: 1.25,   out: 5.00   },
  'mistralai/mistral-large':              { in: 3.00,   out: 9.00   },
  'deepseek/deepseek-chat':               { in: 0.14,   out: 0.28   },
  'default':                              { in: 5.00,   out: 15.00  },
};

function estimateCost(model, inputTokens, outputTokens) {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING['default'];
  return (inputTokens / 1_000_000) * pricing.in + (outputTokens / 1_000_000) * pricing.out;
}

// All capabilities — OpenRouter can handle everything
const SUPPORTED_CAPABILITIES = Object.values(CAPABILITIES);

const OpenRouterAdapter = {
  getName()         { return 'openrouter'; },
  getCapabilities() { return SUPPORTED_CAPABILITIES; },
  getDefaultModel() { return process.env.OPENROUTER_DEFAULT_MODEL || 'anthropic/claude-sonnet-4-5'; },
  getTimeout()      { return Number(process.env.OPENROUTER_TIMEOUT || 22000); },

  validateInput(prompt) {
    if (!prompt?.system?.trim()) throw new AdapterError('INVALID_INPUT', 'prompt must have a non-empty system string');
    if (!prompt?.user?.trim())   throw new AdapterError('INVALID_INPUT', 'prompt must have a non-empty user string');
  },

  /**
   * callOpenRouter — sends request to OpenRouter API
   * Converts Anthropic-style prompt to OpenAI-compatible format (OpenRouter standard)
   */
  async callOpenRouter({ model, prompt, options, timeoutMs }) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new AdapterError('PROVIDER_NOT_CONFIGURED', 'OPENROUTER_API_KEY is not set');

    const messages = [];
    if (prompt.system) messages.push({ role: 'system', content: prompt.system });
    if (prompt.history?.length) messages.push(...prompt.history);
    messages.push({ role: 'user', content: prompt.user });

    const body = {
      model,
      messages,
      max_tokens:  prompt.maxTokens  || options?.maxTokens  || 2000,
      temperature: prompt.temperature ?? options?.temperature ?? 0.7,
    };

    // OpenRouter fallback chain
    if (options?.fallbackModel) {
      body.route   = 'fallback';
      body.models  = [model, options.fallbackModel];
    }

    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), timeoutMs);

    let response;
    try {
      response = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer':  process.env.APP_URL || 'https://saas-yakovi.netlify.app',
          'X-Title':       'CampaignAI',
        },
        body:   JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (err.name === 'AbortError') throw new AdapterError('TIMEOUT', `OpenRouter timed out after ${timeoutMs}ms`);
      throw new AdapterError('NETWORK_ERROR', `OpenRouter network error: ${err.message}`);
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const raw = await response.json().catch(() => ({}));
      const msg = raw?.error?.message || `HTTP ${response.status}`;
      const code = response.status === 429 ? 'RATE_LIMITED'
                 : response.status === 401 ? 'PROVIDER_NOT_CONFIGURED'
                 : 'PROVIDER_ERROR';
      throw new AdapterError(code, `OpenRouter error: ${msg}`);
    }

    return response.json();
  },

  /**
   * callDirectAnthropic — parachute fallback when OpenRouter is down
   * Called only if OpenRouter fails AND task is critical
   */
  async callDirectAnthropic({ prompt, options, timeoutMs }) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new AdapterError('PROVIDER_NOT_CONFIGURED', 'ANTHROPIC_API_KEY is not set for fallback');

    const model = 'claude-sonnet-4-6'; // safe default for direct calls

    const body = {
      model,
      max_tokens: prompt.maxTokens || options?.maxTokens || 2000,
      system:     prompt.system,
      messages:   [
        ...(prompt.history || []),
        { role: 'user', content: prompt.user },
      ],
    };

    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), timeoutMs);

    let response;
    try {
      response = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'Content-Type':      'application/json',
          'x-api-key':         apiKey,
          'anthropic-version': API_VERSION,
        },
        body:   JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (err.name === 'AbortError') throw new AdapterError('TIMEOUT', `Direct Anthropic timed out`);
      throw new AdapterError('NETWORK_ERROR', `Direct Anthropic error: ${err.message}`);
    } finally {
      clearTimeout(timer);
    }

    const raw = await response.json().catch(() => null);
    if (!response.ok) {
      throw new AdapterError('PROVIDER_ERROR', `Direct Anthropic error: ${raw?.error?.message || response.status}`);
    }

    // Convert Anthropic format → OpenAI format for uniform handling
    const text = raw?.content?.find(b => b.type === 'text')?.text || '';
    return {
      id:      raw.id,
      model:   raw.model,
      _direct: true,
      choices: [{ message: { role: 'assistant', content: text } }],
      usage: {
        prompt_tokens:     raw.usage?.input_tokens     || 0,
        completion_tokens: raw.usage?.output_tokens    || 0,
        total_tokens:      (raw.usage?.input_tokens || 0) + (raw.usage?.output_tokens || 0),
      },
    };
  },

  async execute(capability, prompt, options = {}) {
    const model        = options.model        || this.getDefaultModel();
    const fallbackModel = options.fallbackModel;
    const timeoutMs    = options.timeout      || this.getTimeout();
    const start        = Date.now();

    // Skip OpenRouter entirely when no key — go straight to direct Anthropic
    if (!process.env.OPENROUTER_API_KEY) {
      console.log(`[openrouter] no key — using direct Anthropic (${capability})`);
      const raw = await this.callDirectAnthropic({ prompt, options, timeoutMs });
      raw._latency = Date.now() - start;
      raw._via     = 'direct_anthropic';
      raw._cost    = estimateCost('anthropic/claude-sonnet-4-6', raw._usage?.promptTokens || 0, raw._usage?.completionTokens || 0);
      return raw;
    }

    // Try OpenRouter first
    try {
      const raw = await this.callOpenRouter({ model, prompt, options: { ...options, fallbackModel }, timeoutMs });
      raw._model     = raw.model || raw.choices?.[0]?.model || model;
      raw._latency   = Date.now() - start;
      raw._via       = 'openrouter';
      raw._usage = {
        promptTokens:     raw.usage?.prompt_tokens     || 0,
        completionTokens: raw.usage?.completion_tokens || 0,
        totalTokens:      raw.usage?.total_tokens      || 0,
      };
      raw._cost = estimateCost(raw._model, raw._usage.promptTokens, raw._usage.completionTokens);
      return raw;
    } catch (err) {
      // Parachute: if OpenRouter fails, go direct to Anthropic
      if (err.code === 'TIMEOUT' || err.code === 'NETWORK_ERROR' || err.code === 'PROVIDER_NOT_CONFIGURED') {
        console.warn(`[openrouter] falling back to direct Anthropic — reason: ${err.message}`);
        const raw = await this.callDirectAnthropic({ prompt, options, timeoutMs: timeoutMs + 5000 });
        raw._latency = Date.now() - start;
        raw._via     = 'direct_fallback';
        raw._cost    = estimateCost('anthropic/claude-sonnet-4-5', raw._usage?.promptTokens || 0, raw._usage?.completionTokens || 0);
        return raw;
      }
      throw err;
    }
  },

  parseResponse(raw, capability) {
    const text = raw?.choices?.[0]?.message?.content || '';
    if (!text) throw new AdapterError('PARSE_ERROR', 'OpenRouter returned empty content');

    // For structured capabilities — try to extract JSON
    const structuredCaps = [
      CAPABILITIES.AD_COPY, CAPABILITIES.LANDING_PAGE,
      CAPABILITIES.AD_CREATIVE, CAPABILITIES.CAMPAIGN_STRATEGY,
    ];

    if (structuredCaps.includes(capability)) {
      const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/(\{[\s\S]*\})/);
      if (jsonMatch) {
        try { return JSON.parse(jsonMatch[1]); } catch { /* fall through to raw text */ }
      }
    }

    // For chat / conversational capabilities — return as text
    return { text, raw: text };
  },
};

module.exports = OpenRouterAdapter;
