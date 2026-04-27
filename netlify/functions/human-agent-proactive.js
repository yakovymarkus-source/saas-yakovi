'use strict';
require('./_shared/env');

/**
 * human-agent-proactive.js — Proactive message generator
 *
 * POST /human-agent-proactive  (internal — requires x-internal-secret)
 * Body: { userId: string, trigger: 'inactivity'|'goal_check'|'success'|'milestone', context?: object }
 *
 * Returns: { userId, message, channel: 'chat' }
 *
 * Called by a scheduler (e.g. Netlify scheduled function or cron job).
 * The response message is meant to be displayed in the chat UI as an
 * agent-initiated message, NOT a reply to the user.
 */

const { ok, fail, options }    = require('./_shared/http');
const { createRequestContext } = require('./_shared/observability');
const { requireAuthOrInternal } = require('./_shared/auth');
const { parseJsonBody }        = require('./_shared/request');
const { getAdminClient }       = require('./_shared/supabase');
const { AppError }             = require('./_shared/errors');
const mem                      = require('./_shared/human-agent/memory');
const { buildSystemPrompt }    = require('./_shared/human-agent/system-prompt-builder');
const { getPersonalityHints }  = require('./_shared/human-agent/personality-engine');

const CLAUDE_API = 'https://api.anthropic.com/v1/messages';
const MODEL      = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
const TIMEOUT_MS = parseInt(process.env.CLAUDE_TIMEOUT || '22000', 10);

const TRIGGER_PROMPTS = {
  inactivity:  'המשתמש לא התחבר למערכת מזה כמה ימים. שלח הודעה יזומה קצרה וחמה שתדרבן אותו לחזור ולהתקדם. אל תחפור — משפט-שניים מקסימום.',
  goal_check:  'עברו כמה ימים מאז שהמשתמש הגדיר יעדים. שאל אותו בצורה קצרה ואכפתית איפה הוא עומד ביחס ליעדיו.',
  success:     'קרה משהו חיובי במדדים של המשתמש. פרגן אותו בצורה קצרה, אנושית וממוקדת.',
  milestone:   'המשתמש הגיע לאבן דרך (milestone). חגוג את זה איתו בקצרה ודחף להמשיך קדימה.',
};

async function callClaude(systemPrompt, userPrompt) {
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
        max_tokens: 256,
        system:     systemPrompt,
        messages:   [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!res.ok) throw new Error(`Claude API ${res.status}`);
    const data = await res.json();
    return data.content?.find(b => b.type === 'text')?.text || '';
  } finally {
    clearTimeout(timer);
  }
}

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return options();
  if (event.httpMethod !== 'POST') {
    return fail(new AppError({ code: 'METHOD_NOT_ALLOWED', userMessage: 'שיטה לא מורשית', status: 405 }));
  }

  const reqCtx = createRequestContext(event, 'human-agent-proactive');

  try {
    await requireAuthOrInternal(event, 'human-agent-proactive', reqCtx);

    const body    = parseJsonBody(event);
    const userId  = body.userId;
    const trigger = body.trigger || 'inactivity';

    if (!userId) throw new AppError({ code: 'BAD_REQUEST', userMessage: 'חסר userId', status: 400 });

    const triggerPrompt = TRIGGER_PROMPTS[trigger];
    if (!triggerPrompt) throw new AppError({ code: 'BAD_REQUEST', userMessage: `trigger לא מוכר: ${trigger}`, status: 400 });

    const sb  = getAdminClient();
    const ctx = await mem.loadContext(sb, userId);

    const personalityHints = ctx.memory?.birth_date ? getPersonalityHints(ctx.memory.birth_date) : null;

    const systemPrompt = buildSystemPrompt({
      userName:            ctx.userName,
      plan:                ctx.plan,
      genderPreference:    ctx.memory?.gender_preference   || 'male',
      goals:               ctx.memory?.business_goals      || [],
      personalNotes:       ctx.memory?.personal_notes      || [],
      successes:           ctx.memory?.successes           || [],
      communicationStyle:  ctx.memory?.communication_style || {},
      recentSessions:      ctx.recentSessions,
      hasInteractedToday:  false,
      onboardingCompleted: ctx.memory?.onboarding_completed || false,
      personalityHints,
    });

    const message = await callClaude(systemPrompt, triggerPrompt);
    if (!message) throw new AppError({ code: 'AI_ERROR', userMessage: 'לא הצלחתי לייצר הודעה', status: 502 });

    // Save proactive message — non-fatal if DB not ready
    try {
      const conv = await mem.ensureTodayConversation(sb, userId);
      if (conv) {
        const now      = new Date().toISOString();
        const existing = ctx.todayMessages || [];
        await sb.from('human_agent_conversations')
          .update({ messages: [...existing, { role: 'assistant', content: message, ts: now, proactive: true }] })
          .eq('id', conv.id);
      }
    } catch (persistErr) {
      console.warn('[human-agent-proactive] persist skipped:', persistErr.message);
    }

    return ok({ userId, message, trigger, channel: 'chat' }, reqCtx.requestId);

  } catch (err) {
    console.error('[human-agent-proactive]', err);
    return fail(err, reqCtx.requestId);
  }
};
