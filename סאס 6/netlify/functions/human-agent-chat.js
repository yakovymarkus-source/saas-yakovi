'use strict';
require('./_shared/env');

/**
 * human-agent-chat.js — Human Agent (Co-CEO) conversational endpoint
 *
 * POST /human-agent-chat
 * Headers: Authorization: Bearer <supabase-jwt>
 * Body:    { message: string }
 *
 * Returns: { reply: string, isOnboarding?: boolean, toolsUsed?: string[] }
 *
 * Flow:
 *   1. Auth
 *   2. Load user context + memory
 *   3. If first-ever session → return onboarding welcome
 *   4. Build dynamic system prompt
 *   5. Call Claude with tool-use loop
 *   6. Persist conversation turn
 *   7. Return reply
 */

const { ok, fail, options }              = require('./_shared/http');
const { createRequestContext }           = require('./_shared/observability');
const { requireAuth }                    = require('./_shared/auth');
const { parseJsonBody }                  = require('./_shared/request');
const { getAdminClient }                 = require('./_shared/supabase');
const { AppError }                       = require('./_shared/errors');
const mem                                = require('./_shared/human-agent/memory');
const { buildSystemPrompt, buildOnboardingWelcome } = require('./_shared/human-agent/system-prompt-builder');
const { getPersonalityHints }            = require('./_shared/human-agent/personality-engine');
const { TOOLS, executeTool }             = require('./_shared/human-agent/orchestration-bridge');
const { getEnv }                         = require('./_shared/env');

const CLAUDE_API   = 'https://api.anthropic.com/v1/messages';
const MODEL        = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
const MAX_TOKENS   = 1024;
const TIMEOUT_MS   = parseInt(process.env.CLAUDE_TIMEOUT || '22000', 10);
const MAX_ROUNDS   = 4; // tool-use loop safety cap

async function callClaude(systemPrompt, messages, tools) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(CLAUDE_API, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type':    'application/json',
        'x-api-key':       process.env.ANTHROPIC_API_KEY,
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

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new AppError({
        code:       'AI_ERROR',
        userMessage: 'שגיאה בתגובת הסוכן — נסה שוב',
        devMessage:  err?.error?.message || `Claude API ${res.status}`,
        status:      502,
      });
    }

    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function runToolLoop(systemPrompt, history, userMessage, toolContext) {
  let messages   = [...history, { role: 'user', content: userMessage }];
  let finalText  = '';
  const toolsUsed = [];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response    = await callClaude(systemPrompt, messages, TOOLS);
    const stopReason  = response.stop_reason;
    const content     = response.content || [];

    // Collect any text blocks from this turn
    const textParts = content.filter(b => b.type === 'text').map(b => b.text);
    if (textParts.length) finalText += textParts.join('');

    if (stopReason === 'end_turn') break;

    if (stopReason === 'tool_use') {
      const toolBlocks = content.filter(b => b.type === 'tool_use');

      const toolResults = await Promise.all(
        toolBlocks.map(async tb => {
          const result = await executeTool(tb.name, tb.input, toolContext);
          toolsUsed.push(tb.name);
          return { type: 'tool_result', tool_use_id: tb.id, content: JSON.stringify(result) };
        })
      );

      // Extend message thread with assistant turn + tool results
      messages = [
        ...messages,
        { role: 'assistant', content },
        { role: 'user',      content: toolResults },
      ];
      continue;
    }

    // Unexpected stop reason — use whatever text we collected
    break;
  }

  return { reply: finalText || 'מצטער, לא הצלחתי לעבד את הבקשה. נסה שוב.', toolsUsed };
}

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return options();
  if (event.httpMethod !== 'POST') {
    return fail(new AppError({ code: 'METHOD_NOT_ALLOWED', userMessage: 'שיטה לא מורשית', status: 405 }));
  }

  const reqCtx = createRequestContext(event, 'human-agent-chat');

  try {
    const user = await requireAuth(event, 'human-agent-chat', reqCtx);
    const body = parseJsonBody(event);

    const message = (body.message || '').trim();
    if (!message) {
      throw new AppError({ code: 'BAD_REQUEST', userMessage: 'הודעה ריקה', status: 400 });
    }

    const sb = getAdminClient();
    const env = getEnv();

    // ── Bootstrap memory record if new user ──────────────────────────────────
    await mem.ensureMemory(sb, user.id);

    // ── Load full context ─────────────────────────────────────────────────────
    const ctx = await mem.loadContext(sb, user.id);

    // ── First-ever session: return onboarding welcome without calling Claude ──
    if (!ctx.memory?.onboarding_completed && ctx.todayMessages.length === 0 && !ctx.hasInteractedToday) {
      const welcome = buildOnboardingWelcome(ctx.userName, ctx.memory?.gender_preference || 'male');
      const conv    = await mem.ensureTodayConversation(sb, user.id);
      await mem.appendTurn(sb, conv.id, [], message, welcome);
      return ok({ reply: welcome, isOnboarding: true }, reqCtx.requestId);
    }

    // ── Build system prompt ───────────────────────────────────────────────────
    const personalityHints = ctx.memory?.birth_date
      ? getPersonalityHints(ctx.memory.birth_date)
      : null;

    const systemPrompt = buildSystemPrompt({
      userName:           ctx.userName,
      plan:               ctx.plan,
      genderPreference:   ctx.memory?.gender_preference  || 'male',
      goals:              ctx.memory?.business_goals     || [],
      personalNotes:      ctx.memory?.personal_notes     || [],
      recentSessions:     ctx.recentSessions,
      hasInteractedToday: ctx.hasInteractedToday,
      onboardingCompleted: ctx.memory?.onboarding_completed || false,
      personalityHints,
    });

    // ── Load conversation history ─────────────────────────────────────────────
    const history = mem.buildClaudeHistory(ctx.todayMessages);

    // ── Tool context for execution ────────────────────────────────────────────
    const toolContext = {
      sb,
      userId:         user.id,
      appUrl:         env.APP_URL,
      internalSecret: env.SYNC_JOB_INTERNAL_SECRET,
    };

    // ── Run Claude with tool loop ─────────────────────────────────────────────
    const { reply, toolsUsed } = await runToolLoop(systemPrompt, history, message, toolContext);

    // ── Persist turn ──────────────────────────────────────────────────────────
    const conv = await mem.ensureTodayConversation(sb, user.id);
    await mem.appendTurn(sb, conv.id, ctx.todayMessages, message, reply);

    return ok({
      reply,
      ...(toolsUsed.length ? { toolsUsed } : {}),
    }, reqCtx.requestId);

  } catch (err) {
    console.error('[human-agent-chat]', err);
    return fail(err, reqCtx.requestId);
  }
};
