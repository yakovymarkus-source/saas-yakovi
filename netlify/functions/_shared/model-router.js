'use strict';

/**
 * model-router.js — Intelligent request router
 *
 * Tier 1: Rule-based (zero latency) — regex patterns on message content
 * Tier 2: LLM classifier (llama-3.1-8b via OpenRouter, ~300ms) — for ambiguous requests
 *
 * Returns: { taskType, model, fallbackModel, temperature, maxTokens, timeoutMs, useOpenRouter }
 *
 * Config is loaded from ai_model_config table (cached 5 minutes).
 * Falls back to hardcoded defaults if DB is unavailable.
 */

const { createClient } = require('@supabase/supabase-js');

// ── Cache ─────────────────────────────────────────────────────────────────────
let _configCache     = null;
let _configCacheTime = 0;
const CACHE_TTL_MS   = 5 * 60 * 1000; // 5 minutes

function db() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

// ── Hardcoded fallback defaults (used when DB unavailable) ────────────────────
const DEFAULTS = {
  chat:      { model: 'anthropic/claude-sonnet-4-5',          fallback: 'openai/gpt-4o',          temp: 0.7, tokens: 2000, timeout: 22000, openrouter: true  },
  quick:     { model: 'openai/gpt-4o-mini',                   fallback: 'meta-llama/llama-3.1-8b-instruct', temp: 0.5, tokens: 500,  timeout: 8000,  openrouter: true  },
  creative:  { model: 'anthropic/claude-sonnet-4-5',          fallback: 'openai/gpt-4o',          temp: 0.8, tokens: 3000, timeout: 22000, openrouter: true  },
  research:  { model: 'anthropic/claude-opus-4-5',            fallback: 'openai/gpt-4o',          temp: 0.3, tokens: 4000, timeout: 22000, openrouter: false },
  strategy:  { model: 'anthropic/claude-opus-4-5',            fallback: 'openai/gpt-4o',          temp: 0.5, tokens: 4000, timeout: 22000, openrouter: false },
  execution: { model: 'anthropic/claude-sonnet-4-5',          fallback: 'openai/gpt-4o',          temp: 0.6, tokens: 3000, timeout: 22000, openrouter: true  },
  qa:        { model: 'anthropic/claude-sonnet-4-5',          fallback: 'openai/gpt-4o-mini',     temp: 0.3, tokens: 2000, timeout: 22000, openrouter: true  },
  analysis:  { model: 'anthropic/claude-opus-4-5',            fallback: 'openai/gpt-4o',          temp: 0.2, tokens: 4000, timeout: 22000, openrouter: false },
  router:    { model: 'meta-llama/llama-3.1-8b-instruct',     fallback: 'openai/gpt-4o-mini',     temp: 0.0, tokens: 200,  timeout: 5000,  openrouter: true  },
};

// ── Tier 1: Rule-based patterns (zero latency) ────────────────────────────────
const TIER1_RULES = [
  // Hebrew/English quick questions — handle with fast model
  { pattern: /^.{1,60}[?？]$/, taskType: 'quick' },

  // Creative content generation
  { pattern: /\b(כתוב|כתיבה|כותרת|headline|מודעה|ad copy|קופי|copy|נוסח|נסח)\b/i, taskType: 'creative' },
  { pattern: /\b(דף נחיתה|landing page|תוכן שיווקי|מסר|סלוגן|slogan)\b/i, taskType: 'creative' },

  // Analysis (heavy)
  { pattern: /\b(נתח|ניתוח|analyse|analyze|analysis|breakdown|פירוט מלא)\b/i, taskType: 'analysis' },

  // Research (heavy)
  { pattern: /\b(מחקר|research|חקור|competitor|מתחרה|שוק|market)\b/i, taskType: 'research' },

  // Strategy (heavy)
  { pattern: /\b(אסטרטגיה|strategy|תכנית|plan|מפת דרכים|roadmap|יעדים|goals)\b/i, taskType: 'strategy' },

  // QA
  { pattern: /\b(בדוק|check|בקרת איכות|quality|review|שגיאה|error|תקן)\b/i, taskType: 'qa' },
];

// ── Load config from DB (cached) ──────────────────────────────────────────────
async function loadConfig() {
  const now = Date.now();
  if (_configCache && now - _configCacheTime < CACHE_TTL_MS) return _configCache;

  try {
    const { data } = await db()
      .from('ai_model_config')
      .select('task_type, primary_model, fallback_model, use_openrouter, temperature, max_tokens, timeout_ms, enabled');

    if (data?.length) {
      const map = {};
      for (const row of data) {
        if (!row.enabled) continue;
        map[row.task_type] = {
          model:       row.primary_model,
          fallback:    row.fallback_model,
          temp:        Number(row.temperature),
          tokens:      row.max_tokens,
          timeout:     row.timeout_ms,
          openrouter:  row.use_openrouter,
        };
      }
      _configCache     = map;
      _configCacheTime = now;
      return map;
    }
  } catch (e) {
    console.warn('[model-router] DB config load failed, using defaults:', e.message);
  }

  return DEFAULTS;
}

// ── Tier 2: LLM classifier (only for ambiguous requests) ─────────────────────
async function classifyWithLLM(message) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return 'chat'; // can't classify without OpenRouter

  const config  = await loadConfig();
  const routerCfg = config.router || DEFAULTS.router;

  const prompt = `You are a request classifier. Classify the following user message into exactly ONE category.

Categories:
- quick: short question, factual, under 3 words answer expected
- chat: general conversation, advice, or discussion
- creative: writing ads, copy, headlines, landing page content
- analysis: analyzing data, metrics, performance breakdown
- research: market research, competitor analysis
- strategy: planning, goals, roadmap, campaign strategy
- qa: quality check, review, error fix

Message: "${message.slice(0, 300)}"

Reply with ONLY the category name, nothing else.`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), routerCfg.timeout || 5000);

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer':  process.env.APP_URL || '',
        'X-Title':       'CampaignAI-Router',
      },
      body: JSON.stringify({
        model:       routerCfg.model,
        messages:    [{ role: 'user', content: prompt }],
        max_tokens:  routerCfg.tokens || 20,
        temperature: 0,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) return 'chat';
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content?.trim().toLowerCase() || 'chat';
    const valid = Object.keys(DEFAULTS);
    return valid.includes(text) ? text : 'chat';
  } catch {
    return 'chat'; // safe default on classifier failure
  }
}

// ── Main router function ──────────────────────────────────────────────────────
/**
 * route(message, forcedTaskType?) → routing decision
 *
 * @param {string} message       — user's message text
 * @param {string} [forceTask]   — skip classification, use this task type directly
 * @param {boolean} [skipTier2] — skip LLM classifier (e.g. for internal calls)
 *
 * @returns {{ taskType, model, fallbackModel, temperature, maxTokens, timeoutMs, useOpenRouter }}
 */
async function route(message, forceTask, skipTier2 = false) {
  const config = await loadConfig();

  let taskType = forceTask || null;

  // Tier 1: Rule-based (zero latency)
  if (!taskType) {
    for (const rule of TIER1_RULES) {
      if (rule.pattern.test(message)) {
        taskType = rule.taskType;
        break;
      }
    }
  }

  // Tier 2: LLM classifier for ambiguous requests
  if (!taskType && !skipTier2) {
    taskType = await classifyWithLLM(message);
  }

  // Default fallback
  if (!taskType) taskType = 'chat';

  const cfg = config[taskType] || DEFAULTS[taskType] || DEFAULTS.chat;

  return {
    taskType,
    model:         cfg.model,
    fallbackModel: cfg.fallback,
    temperature:   cfg.temp,
    maxTokens:     cfg.tokens,
    timeoutMs:     cfg.timeout,
    useOpenRouter: cfg.openrouter,
  };
}

/** Force-clear cache (used after admin updates config) */
function clearConfigCache() {
  _configCache     = null;
  _configCacheTime = 0;
}

module.exports = { route, loadConfig, clearConfigCache, DEFAULTS };
