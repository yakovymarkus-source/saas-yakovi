'use strict';
require('./_shared/env');

/**
 * human-agent-whatsapp-webhook.js
 *
 * GET  → Meta webhook verification (hub.challenge)
 * POST → Incoming WhatsApp message (Meta or Twilio) → human-agent reply
 *
 * Infrastructure only — no live credentials needed yet.
 * Set WHATSAPP_PROVIDER=meta|twilio and matching env vars when going live.
 */

const { getAdminClient } = require('./_shared/supabase');
const mem                = require('./_shared/human-agent/memory');
const { buildSystemPrompt }     = require('./_shared/human-agent/system-prompt-builder');
const { getPersonalityHints }   = require('./_shared/human-agent/personality-engine');
const { TOOLS, executeTool }    = require('./_shared/human-agent/orchestration-bridge');
const {
  sendWhatsAppMessage,
  parseIncomingMessage,
  verifyMetaWebhook,
} = require('./_shared/human-agent/whatsapp');
const { getEnv } = require('./_shared/env');

const CLAUDE_API  = 'https://api.anthropic.com/v1/messages';
const MODEL       = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
const MAX_TOKENS  = 1024; // keep replies concise for WhatsApp
const TIMEOUT_MS  = 20000;
const MAX_ROUNDS  = 3;

// ── Claude call ───────────────────────────────────────────────────────────────
async function callClaude(systemPrompt, messages, tools) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(CLAUDE_API, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      MODEL,
        max_tokens: MAX_TOKENS,
        system:     systemPrompt,
        messages,
        ...(tools.length ? { tools, tool_choice: { type: 'auto' } } : {}),
      }),
    });
    if (!res.ok) throw new Error(`Claude ${res.status}`);
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ── Tool loop (same pattern as human-agent-chat) ──────────────────────────────
async function runToolLoop(systemPrompt, history, userMessage, toolContext) {
  let messages  = [...history, { role: 'user', content: userMessage }];
  let finalText = '';

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response   = await callClaude(systemPrompt, messages, TOOLS);
    const stopReason = response.stop_reason;
    const content    = response.content || [];

    const textParts = content.filter(b => b.type === 'text').map(b => b.text);
    if (textParts.length) finalText += textParts.join('');

    if (stopReason === 'end_turn') break;

    if (stopReason === 'tool_use') {
      const toolBlocks = content.filter(b => b.type === 'tool_use');
      const toolResults = await Promise.all(
        toolBlocks.map(async tb => {
          const result = await executeTool(tb.name, tb.input, toolContext);
          return { type: 'tool_result', tool_use_id: tb.id, content: JSON.stringify(result) };
        })
      );
      messages = [
        ...messages,
        { role: 'assistant', content },
        { role: 'user',      content: toolResults },
      ];
      continue;
    }
    break;
  }

  return finalText || 'מצטער, לא הצלחתי לעבד את הבקשה כרגע.';
}

// ── Resolve user by WhatsApp phone number ─────────────────────────────────────
async function resolveUserByPhone(sb, phone) {
  // Normalise: strip leading + and spaces
  const normalised = phone.replace(/^\+/, '').replace(/\s/g, '');
  const { data } = await sb
    .from('profiles')
    .select('id, name')
    .eq('whatsapp_phone', normalised)
    .maybeSingle();
  return data || null; // null = unknown number
}

// ── Main handler ──────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  // ── Meta webhook verification (GET) ──────────────────────────────────────
  if (event.httpMethod === 'GET') {
    const challenge = verifyMetaWebhook(event.queryStringParameters || {});
    if (challenge) return { statusCode: 200, body: challenge };
    return { statusCode: 403, body: 'Forbidden' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // ── Parse incoming message ────────────────────────────────────────────────
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: 'Bad Request' };
  }

  const incoming = parseIncomingMessage(body);
  if (!incoming) {
    // Could be a delivery status update — acknowledge silently
    return { statusCode: 200, body: 'ok' };
  }

  const { from, text, messageId } = incoming;
  if (!text?.trim()) return { statusCode: 200, body: 'ok' };

  const sb  = getAdminClient();
  const env = getEnv();

  // ── Resolve user ──────────────────────────────────────────────────────────
  const profile = await resolveUserByPhone(sb, from);
  if (!profile) {
    // Unknown number — optionally send a registration prompt
    await sendWhatsAppMessage(from, 'מספר זה אינו מקושר לחשבון פעיל. התחבר דרך האפליקציה בכתובת ' + (env.APP_URL || ''));
    return { statusCode: 200, body: 'unknown user' };
  }

  const userId = profile.id;

  // ── Duplicate-message guard (idempotency) ─────────────────────────────────
  const { data: existing } = await sb
    .from('human_agent_conversations')
    .select('id')
    .eq('user_id', userId)
    .contains('messages', JSON.stringify([{ whatsapp_message_id: messageId }]))
    .maybeSingle()
    .catch(() => ({ data: null }));
  if (existing) return { statusCode: 200, body: 'duplicate' };

  try {
    // ── Load context + memory ───────────────────────────────────────────────
    await mem.ensureMemory(sb, userId);
    const ctx = await mem.loadContext(sb, userId);

    const personalityHints = ctx.memory?.birth_date
      ? getPersonalityHints(ctx.memory.birth_date)
      : null;

    const systemPrompt = buildSystemPrompt({
      userName:            ctx.userName,
      plan:                ctx.plan,
      genderPreference:    ctx.memory?.gender_preference   || 'male',
      goals:               ctx.memory?.business_goals      || [],
      personalNotes:       ctx.memory?.personal_notes      || [],
      successes:           ctx.memory?.successes           || [],
      communicationStyle:  ctx.memory?.communication_style || {},
      recentSessions:      ctx.recentSessions,
      hasInteractedToday:  ctx.hasInteractedToday,
      onboardingCompleted: ctx.memory?.onboarding_completed || false,
      personalityHints,
      channel: 'whatsapp',
    });

    const history = mem.buildClaudeHistory(ctx.todayMessages);

    const toolContext = {
      sb,
      userId,
      appUrl:         env.APP_URL,
      internalSecret: env.SYNC_JOB_INTERNAL_SECRET,
    };

    // ── Run agent ───────────────────────────────────────────────────────────
    const reply = await runToolLoop(systemPrompt, history, text.trim(), toolContext);

    // ── Persist turn (non-fatal) ────────────────────────────────────────────
    try {
      const conv = await mem.ensureTodayConversation(sb, userId);
      if (conv) {
        await mem.appendTurn(sb, conv.id, ctx.todayMessages, text.trim(), reply, {
          whatsapp_message_id: messageId,
          channel: 'whatsapp',
        });
      }
    } catch (persistErr) {
      console.warn('[whatsapp-webhook] persist skipped:', persistErr.message);
    }

    // ── Send reply via WhatsApp ─────────────────────────────────────────────
    await sendWhatsAppMessage(from, reply);

    return { statusCode: 200, body: 'ok' };
  } catch (err) {
    console.error('[whatsapp-webhook]', err.message);
    // Best-effort error reply so user isn't left in silence
    await sendWhatsAppMessage(from, 'אירעה שגיאה זמנית — נסה שוב עוד כמה שניות').catch(() => {});
    return { statusCode: 200, body: 'error handled' };
  }
};
