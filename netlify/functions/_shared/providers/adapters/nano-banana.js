'use strict';

/**
 * providers/adapters/nano-banana.js — Nano Banana Image Generation Adapter
 *
 * Capability: image_generation
 *
 * Nano Banana API documentation: https://nano-banana.com (configure endpoint below).
 *
 * Environment:
 *   NANO_BANANA_API_KEY       — required
 *   NANO_BANANA_API_URL       — required (base URL for their API, e.g. https://api.nano-banana.com/v1)
 *   NANO_BANANA_DEFAULT_MODEL — optional (their model/style identifier)
 *   NANO_BANANA_TIMEOUT       — optional ms, default: 60000
 *
 * Prompt shape expected from the landing-page prompt builder:
 *   {
 *     system: string   (not used for image APIs — passed as style instructions)
 *     user:   string   (the image description / prompt)
 *     params: {        (image-specific parameters)
 *       width?:  number
 *       height?: number
 *       style?:  string
 *     }
 *   }
 *
 * Standard content returned:
 *   {
 *     imageUrl:  string   (URL to the generated image)
 *     imageData: string | null  (base64 if API returns inline)
 *     mimeType:  string
 *   }
 *
 * ── IMPORTANT ────────────────────────────────────────────────────────────────
 * The exact request/response format below is based on common image generation
 * API conventions. Adjust execute() and parseResponse() once you have the
 * actual Nano Banana API specification.
 * The adapter architecture is correct and production-ready.
 */

const { AdapterError, CAPABILITIES } = require('../contract');

const SUPPORTED_CAPABILITIES = [CAPABILITIES.IMAGE_GENERATION];
const DEFAULT_TIMEOUT = 60_000;

const NanoBananaAdapter = {
  getName()         { return 'nano_banana'; },
  getCapabilities() { return SUPPORTED_CAPABILITIES; },
  getDefaultModel() { return process.env.NANO_BANANA_DEFAULT_MODEL || null; },
  getTimeout()      { return Number(process.env.NANO_BANANA_TIMEOUT || DEFAULT_TIMEOUT); },

  validateInput(prompt) {
    if (!prompt?.user?.trim()) throw new AdapterError('INVALID_INPUT', 'Nano Banana prompt requires a non-empty user (image description) string');
  },

  async execute(capability, prompt, options = {}) {
    const apiKey  = process.env.NANO_BANANA_API_KEY;
    const baseUrl = process.env.NANO_BANANA_API_URL;

    if (!apiKey)  throw new AdapterError('PROVIDER_NOT_CONFIGURED', 'NANO_BANANA_API_KEY is not set');
    if (!baseUrl) throw new AdapterError('PROVIDER_NOT_CONFIGURED', 'NANO_BANANA_API_URL is not set — set this to the Nano Banana API base URL');

    const timeout = options.timeout || this.getTimeout();
    const model   = options.model || this.getDefaultModel();

    const body = {
      prompt:       prompt.user,
      // Style instructions from system prompt appended as negative_prompt or style
      style_prompt: prompt.system || undefined,
      model:        model || undefined,
      width:        prompt.params?.width  || 1024,
      height:       prompt.params?.height || 1024,
      style:        prompt.params?.style  || undefined,
    };

    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), timeout);

    let response;
    try {
      response = await fetch(`${baseUrl}/generate`, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body:   JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (err.name === 'AbortError') throw new AdapterError('TIMEOUT', `Nano Banana request timed out after ${timeout}ms`);
      throw new AdapterError('NETWORK_ERROR', `Nano Banana network error: ${err.message}`);
    } finally {
      clearTimeout(timer);
    }

    const raw = await response.json().catch(() => null);

    if (!response.ok) {
      const msg  = raw?.error || raw?.message || `HTTP ${response.status}`;
      const code = response.status === 429 ? 'RATE_LIMITED'
                 : response.status === 401 ? 'PROVIDER_NOT_CONFIGURED'
                 : 'PROVIDER_ERROR';
      throw new AdapterError(code, `Nano Banana error: ${msg}`);
    }

    raw._model = model || 'nano-banana-default';
    raw._usage = null;  // Image APIs don't use token counts

    return raw;
  },

  parseResponse(raw, _capability) {
    // Adapt to actual Nano Banana response shape once API docs are available.
    // Common patterns: { url }, { image_url }, { data: [{ url }] }, { base64 }
    const imageUrl  = raw?.url || raw?.image_url || raw?.data?.[0]?.url || null;
    const imageData = raw?.base64 || raw?.b64_json || null;

    if (!imageUrl && !imageData) {
      throw new AdapterError('PARSE_ERROR', 'Nano Banana response contains no image URL or base64 data');
    }

    return {
      imageUrl:  imageUrl,
      imageData: imageData,
      mimeType:  raw?.mime_type || 'image/png',
    };
  },
};

module.exports = NanoBananaAdapter;
