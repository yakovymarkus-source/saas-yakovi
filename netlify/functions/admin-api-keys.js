'use strict';

/**
 * admin-api-keys.js — Manage AI provider API keys from the admin panel
 *
 * GET  /admin-api-keys        — list all known keys (masked values)
 * POST /admin-api-keys        — update one or more keys
 *                               body: { OPENROUTER_API_KEY?: string, ANTHROPIC_API_KEY?: string, OPENAI_API_KEY?: string }
 * DELETE /admin-api-keys/:key — remove a key (restore to empty)
 *
 * Stores keys as Netlify env vars via the Netlify REST API.
 * Requires NETLIFY_TOKEN + NETLIFY_SITE_ID env vars (set once via CLI).
 */

require('./_shared/env');

const { ok, fail, options }                     = require('./_shared/http');
const { createRequestContext, buildLogPayload }  = require('./_shared/observability');
const { writeRequestLog }                        = require('./_shared/supabase');
const { requireAdmin }                           = require('./_shared/admin-auth');
const { AppError }                               = require('./_shared/errors');

const KNOWN_KEYS = [
  { key: 'OPENROUTER_API_KEY', label: 'OpenRouter API Key',  hint: 'sk-or-v1-...  Primary AI provider (chat + copy + landing pages)',  required: true  },
  { key: 'ANTHROPIC_API_KEY',  label: 'Anthropic API Key',   hint: 'sk-ant-...  Fallback AI provider (direct Claude)',                  required: false },
  { key: 'OPENAI_API_KEY',     label: 'OpenAI / DALL-E Key', hint: 'sk-proj-...  Image generation (DALL-E 3)',                          required: true  },
];

// ── Netlify REST helpers ────────────────────────────────────────────────────────

function netlifyHeaders() {
  const token = process.env.NETLIFY_TOKEN;
  if (!token) throw new AppError({ code: 'INTERNAL_ERROR', userMessage: 'NETLIFY_TOKEN not configured', status: 500 });
  return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };
}

function siteId() {
  const id = process.env.NETLIFY_SITE_ID;
  if (!id) throw new AppError({ code: 'INTERNAL_ERROR', userMessage: 'NETLIFY_SITE_ID not configured', status: 500 });
  return id;
}

function readEnvVar(key) {
  // Read directly from process.env — always up-to-date at function runtime
  return process.env[key] || '';
}

async function netlifySetEnvVar(key, value) {
  // Try PATCH first (update existing), then POST (create new)
  const patchRes = await fetch(
    `https://api.netlify.com/api/v1/sites/${siteId()}/env/${key}`,
    {
      method: 'PATCH',
      headers: netlifyHeaders(),
      body: JSON.stringify({ value, context: 'all' }),
    }
  );
  if (patchRes.ok) return;

  // Key doesn't exist — create it
  const postRes = await fetch(
    `https://api.netlify.com/api/v1/sites/${siteId()}/env`,
    {
      method: 'POST',
      headers: netlifyHeaders(),
      body: JSON.stringify([{ key, values: [{ value, context: 'all' }], scopes: ['functions'] }]),
    }
  );
  if (!postRes.ok) {
    const body = await postRes.text().catch(() => '');
    throw new AppError({ code: 'INTERNAL_ERROR', userMessage: `Failed to set ${key}: ${body.slice(0, 200)}`, status: 500 });
  }
}

// Mask a value: show first 8 chars + *** + last 4 chars
function maskValue(v) {
  if (!v) return '';
  if (v.length <= 12) return '****';
  return v.slice(0, 8) + '****' + v.slice(-4);
}

// ── Handler ─────────────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options();
  const context = createRequestContext(event, 'admin-api-keys');

  try {
    await requireAdmin(event, context.functionName, context);

    // ── GET: return list of keys with masked values ─────────────────────────────
    if (event.httpMethod === 'GET') {
      const results = KNOWN_KEYS.map((meta) => {
          const rawVal = readEnvVar(meta.key);
          const isSet  = rawVal.length > 10;
          return {
            key:      meta.key,
            label:    meta.label,
            hint:     meta.hint,
            required: meta.required,
            isSet,
            masked:   isSet ? maskValue(rawVal) : '',
          };
        });

      await writeRequestLog(buildLogPayload(context, 'info', 'admin_api_keys_read', {}));
      return ok({ keys: results }, context.requestId);
    }

    // ── POST: update one or more keys ───────────────────────────────────────────
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const updated = [];
      const errors  = [];

      for (const meta of KNOWN_KEYS) {
        const newVal = (body[meta.key] || '').trim();
        if (!newVal) continue; // skip keys not included in request
        try {
          await netlifySetEnvVar(meta.key, newVal);
          updated.push(meta.key);
        } catch (e) {
          errors.push({ key: meta.key, error: e.userMessage || e.message });
        }
      }

      if (errors.length && !updated.length) {
        throw new AppError({ code: 'INTERNAL_ERROR', userMessage: errors[0].error, status: 500 });
      }

      await writeRequestLog(buildLogPayload(context, 'info', 'admin_api_keys_updated', { updated }));
      return ok({
        updated,
        errors,
        message: `עודכנו ${updated.length} מפתחות. נדרש redeploy כדי שהשינויים יכנסו לתוקף.`,
        needsRedeploy: true,
      }, context.requestId);
    }

    throw new AppError({ code: 'METHOD_NOT_ALLOWED', status: 405 });

  } catch (error) {
    await writeRequestLog(buildLogPayload(context, 'error', 'admin_api_keys_failed', { code: error.code })).catch(() => {});
    return fail(error, context.requestId);
  }
};
