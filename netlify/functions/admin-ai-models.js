'use strict';
/**
 * admin-ai-models.js
 * GET    /api/admin-ai-models              → list all model configs + cost summary
 * PUT    /api/admin-ai-models              → update a task config
 * DELETE /api/admin-ai-models?task=xxx     → reset task to defaults
 * POST   /api/admin-ai-models/test         → test a model with a sample prompt
 *
 * Admin only — requires is_admin = true in profiles table.
 */

require('./_shared/env');
const { createClient } = require('@supabase/supabase-js');
const { clearConfigCache } = require('./_shared/model-router');

function db()   { return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY); }
function anon() { return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY); }

async function requireAdmin(token) {
  if (!token) return null;
  const { data: { user }, error } = await anon().auth.getUser(token);
  if (error || !user) return null;
  const { data: profile } = await db().from('profiles').select('is_admin').eq('id', user.id).maybeSingle();
  if (!profile?.is_admin) return null;
  return user;
}

// Available models for dropdown (curated list)
const AVAILABLE_MODELS = [
  // Anthropic
  { id: 'anthropic/claude-opus-4-5',        label: 'Claude Opus 4.5 — הכי חזק',     provider: 'Anthropic', tier: 'heavy'  },
  { id: 'anthropic/claude-sonnet-4-5',      label: 'Claude Sonnet 4.5 — מאוזן',     provider: 'Anthropic', tier: 'mid'    },
  { id: 'anthropic/claude-haiku-4-5',       label: 'Claude Haiku 4.5 — מהיר',       provider: 'Anthropic', tier: 'fast'   },
  // OpenAI
  { id: 'openai/gpt-4o',                   label: 'GPT-4o — מאוזן',                 provider: 'OpenAI',    tier: 'mid'    },
  { id: 'openai/gpt-4o-mini',              label: 'GPT-4o Mini — זול ומהיר',        provider: 'OpenAI',    tier: 'fast'   },
  { id: 'openai/o1-mini',                  label: 'o1-mini — reasoning',             provider: 'OpenAI',    tier: 'mid'    },
  // Meta
  { id: 'meta-llama/llama-3.1-8b-instruct',  label: 'Llama 3.1 8B — הכי זול',      provider: 'Meta',      tier: 'fast'   },
  { id: 'meta-llama/llama-3.1-70b-instruct', label: 'Llama 3.1 70B — בינוני',       provider: 'Meta',      tier: 'mid'    },
  { id: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B — עדכני',        provider: 'Meta',      tier: 'mid'    },
  // Google
  { id: 'google/gemini-flash-1.5',         label: 'Gemini Flash 1.5 — מהיר',        provider: 'Google',    tier: 'fast'   },
  { id: 'google/gemini-pro-1.5',           label: 'Gemini Pro 1.5 — חזק',           provider: 'Google',    tier: 'mid'    },
  // DeepSeek
  { id: 'deepseek/deepseek-chat',          label: 'DeepSeek Chat — זול',             provider: 'DeepSeek',  tier: 'fast'   },
  { id: 'deepseek/deepseek-r1',            label: 'DeepSeek R1 — reasoning',         provider: 'DeepSeek',  tier: 'mid'    },
  // Mistral
  { id: 'mistralai/mistral-large',         label: 'Mistral Large — אירופאי',         provider: 'Mistral',   tier: 'mid'    },
  { id: 'mistralai/mistral-7b-instruct',   label: 'Mistral 7B — זול',               provider: 'Mistral',   tier: 'fast'   },
];

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, body: '' };

  const token = (event.headers['authorization'] || '').replace('Bearer ', '');
  const admin = await requireAdmin(token);
  if (!admin) return { statusCode: 403, body: JSON.stringify({ error: 'Admin access required' }) };

  const supabase = db();
  const path     = event.path || '';
  const isTest   = path.includes('/test');

  // ── TEST a model ─────────────────────────────────────────────────────────────
  if (event.httpMethod === 'POST' && isTest) {
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

    const { model, prompt: testPrompt } = body;
    if (!model) return { statusCode: 400, body: JSON.stringify({ error: 'model required' }) };

    const OpenRouterAdapter = require('./_shared/providers/adapters/openrouter');
    const start = Date.now();
    try {
      const raw = await OpenRouterAdapter.execute('chat', {
        system:    'You are a test assistant. Reply in 1 sentence.',
        user:      testPrompt || 'Say hello in Hebrew.',
        maxTokens: 100,
      }, { model, timeout: 10000 });

      return {
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ok:        true,
          model:     raw._model || model,
          via:       raw._via,
          reply:     raw?.choices?.[0]?.message?.content || '',
          latency_ms: Date.now() - start,
          cost_usd:  raw._cost || 0,
        }),
      };
    } catch (err) {
      return {
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ok: false, error: err.message, latency_ms: Date.now() - start }),
      };
    }
  }

  // ── GET — list configs + cost summary ────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    const [configRes, costRes] = await Promise.all([
      supabase.from('ai_model_config').select('*').order('task_type'),
      supabase.from('ai_cost_log')
        .select('task_type, model_used, provider, cost_usd, latency_ms, success, created_at')
        .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false })
        .limit(1000),
    ]);

    // Aggregate costs per task_type
    const costByTask = {};
    let totalCost = 0;
    let totalCalls = 0;
    for (const row of (costRes.data || [])) {
      if (!costByTask[row.task_type]) costByTask[row.task_type] = { cost: 0, calls: 0, avgLatency: 0 };
      costByTask[row.task_type].cost      += Number(row.cost_usd) || 0;
      costByTask[row.task_type].calls     += 1;
      costByTask[row.task_type].avgLatency = Math.round(
        (costByTask[row.task_type].avgLatency * (costByTask[row.task_type].calls - 1) + (row.latency_ms || 0)) / costByTask[row.task_type].calls
      );
      totalCost  += Number(row.cost_usd) || 0;
      totalCalls += 1;
    }

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ok:             true,
        configs:        configRes.data || [],
        availableModels: AVAILABLE_MODELS,
        costSummary: {
          totalCost30d:  Number(totalCost.toFixed(4)),
          totalCalls30d: totalCalls,
          byTask:        costByTask,
        },
      }),
    };
  }

  // ── PUT — update a task config ────────────────────────────────────────────────
  if (event.httpMethod === 'PUT') {
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

    const { task_type, primary_model, fallback_model, use_openrouter, enabled, temperature, max_tokens, timeout_ms, notes } = body;
    if (!task_type) return { statusCode: 400, body: JSON.stringify({ error: 'task_type required' }) };

    const update = {
      updated_at:  new Date().toISOString(),
      updated_by:  admin.id,
    };
    if (primary_model   !== undefined) update.primary_model   = primary_model;
    if (fallback_model  !== undefined) update.fallback_model  = fallback_model;
    if (use_openrouter  !== undefined) update.use_openrouter  = Boolean(use_openrouter);
    if (enabled         !== undefined) update.enabled         = Boolean(enabled);
    if (temperature     !== undefined) update.temperature     = Number(temperature);
    if (max_tokens      !== undefined) update.max_tokens      = Number(max_tokens);
    if (timeout_ms      !== undefined) update.timeout_ms      = Number(timeout_ms);
    if (notes           !== undefined) update.notes           = notes;

    const { error } = await supabase.from('ai_model_config').update(update).eq('task_type', task_type);
    if (error) return { statusCode: 500, body: JSON.stringify({ error: error.message }) };

    // Clear router cache so changes take effect immediately
    clearConfigCache();

    return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ok: true }) };
  }

  // ── DELETE — reset to defaults ────────────────────────────────────────────────
  if (event.httpMethod === 'DELETE') {
    const taskType = event.queryStringParameters?.task;
    if (!taskType) return { statusCode: 400, body: JSON.stringify({ error: 'task query param required' }) };

    const { DEFAULTS } = require('./_shared/model-router');
    const def = DEFAULTS[taskType];
    if (!def) return { statusCode: 404, body: JSON.stringify({ error: 'Unknown task type' }) };

    await supabase.from('ai_model_config').update({
      primary_model:  def.model,
      fallback_model: def.fallback,
      use_openrouter: def.openrouter,
      temperature:    def.temp,
      max_tokens:     def.tokens,
      timeout_ms:     def.timeout,
      updated_at:     new Date().toISOString(),
      updated_by:     admin.id,
    }).eq('task_type', taskType);

    clearConfigCache();
    return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ok: true }) };
  }

  return { statusCode: 405, body: 'Method Not Allowed' };
};
