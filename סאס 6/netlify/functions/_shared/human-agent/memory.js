'use strict';

const MAX_TURNS_IN_CONTEXT = 20; // last 20 turns sent to Claude per session
const MAX_RECENT_SESSIONS  = 5;  // last 5 session summaries loaded as long-term context

// ── Session summarizer ────────────────────────────────────────────────────────
// Called lazily at the start of a new day — summarises yesterday's session
// so important context survives beyond the 20-turn window.

const SUMMARY_PROMPT = `אתה מסכם שיחה בין סוכן עסקי למשתמש.
מטרה: לחלץ את הדברים החשובים ביותר שנלמדו בשיחה הזו בלבד.
פורמט הפלט — JSON בלבד, ללא טקסט נוסף:
{
  "summary": "2-3 משפטים בעברית: מה הייתה המטרה, מה קרה, מה הוחלט",
  "learned": ["תובנה 1", "תובנה 2"],
  "action_items": ["משימה שנשארה פתוחה"]
}
אם לא נלמד שום דבר משמעותי — החזר רק {"summary": "שיחה כללית", "learned": [], "action_items": []}`;

async function generateSessionSummary(messages) {
  const CLAUDE_API = 'https://api.anthropic.com/v1/messages';
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !messages?.length) return null;

  // Build a readable transcript (max last 30 messages to keep cost low)
  const transcript = messages
    .slice(-30)
    .map(m => `${m.role === 'user' ? 'משתמש' : 'סוכן'}: ${m.content}`)
    .join('\n');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch(CLAUDE_API, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
        max_tokens: 300,
        system:     SUMMARY_PROMPT,
        messages:   [{ role: 'user', content: transcript }],
      }),
    });

    if (!res.ok) return null;
    const data = await res.json();
    const raw  = data.content?.find(b => b.type === 'text')?.text || '';

    // Extract JSON — model may wrap it in a code block
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Summarise yesterday's session if it has messages but no summary yet.
// Called at the start of every new-day conversation — fire-and-forget is fine.
async function summarizeYesterdaySession(sb, userId) {
  try {
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

    const { data } = await sb
      .from('human_agent_conversations')
      .select('id, messages, summary')
      .eq('user_id', userId)
      .eq('session_date', yesterday)
      .maybeSingle();

    // Nothing to summarise
    if (!data || data.summary || !data.messages?.length || data.messages.length < 4) return;

    const parsed = await generateSessionSummary(data.messages);
    if (!parsed) return;

    const summaryText = [
      parsed.summary,
      parsed.learned?.length  ? `נלמד: ${parsed.learned.join(' | ')}` : '',
      parsed.action_items?.length ? `פתוח: ${parsed.action_items.join(' | ')}` : '',
    ].filter(Boolean).join('\n');

    await sb
      .from('human_agent_conversations')
      .update({ summary: summaryText })
      .eq('id', data.id);
  } catch {
    // Non-critical — don't break the main flow
  }
}

// ── Context loader ────────────────────────────────────────────────────────────

async function loadContext(sb, userId) {
  const today = new Date().toISOString().split('T')[0];

  const [memRes, profileRes, subRes, todayRes, recentRes] = await Promise.all([
    sb.from('human_agent_memory').select('*').eq('user_id', userId).maybeSingle(),
    sb.from('profiles').select('name').eq('id', userId).maybeSingle(),
    sb.from('subscriptions').select('plan, status').eq('user_id', userId).eq('status', 'active').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    sb.from('human_agent_conversations').select('id, messages').eq('user_id', userId).eq('session_date', today).maybeSingle(),
    sb.from('human_agent_conversations')
      .select('summary, session_date')
      .eq('user_id', userId)
      .lt('session_date', today)
      .not('summary', 'is', null)            // only sessions that have a summary
      .order('session_date', { ascending: false })
      .limit(MAX_RECENT_SESSIONS),
  ]);

  const memory    = memRes.data   || null;
  const todayConv = todayRes.data || null;
  const messages  = todayConv?.messages || [];

  return {
    memory,
    userName:           profileRes.data?.name || '',
    plan:               subRes.data?.plan     || 'free',
    todayConvId:        todayConv?.id         || null,
    todayMessages:      messages,
    hasInteractedToday: messages.length > 0,
    recentSessions:     recentRes.data        || [],
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function ensureMemory(sb, userId) {
  const { data, error } = await sb
    .from('human_agent_memory')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle();

  if (error?.code === '42P01') {
    throw new Error('MIGRATION_REQUIRED: טבלאות הסוכן האנושי לא נוצרו עדיין — יש להריץ את human-agent-migration.sql בסופרבייס');
  }
  if (!data) {
    await sb.from('human_agent_memory').insert({ user_id: userId });
  }
}

async function ensureTodayConversation(sb, userId) {
  const today = new Date().toISOString().split('T')[0];
  const { data, error } = await sb
    .from('human_agent_conversations')
    .select('id, messages')
    .eq('user_id', userId)
    .eq('session_date', today)
    .maybeSingle();

  if (error?.code === '42P01') {
    throw new Error('MIGRATION_REQUIRED: טבלאות הסוכן האנושי לא נוצרו עדיין — יש להריץ את human-agent-migration.sql בסופרבייס');
  }

  if (data) return data;

  const { data: created, error: insertErr } = await sb
    .from('human_agent_conversations')
    .insert({ user_id: userId, session_date: today, messages: [] })
    .select('id, messages')
    .single();

  if (insertErr) throw new Error(`שגיאה ביצירת שיחה: ${insertErr.message}`);
  return created;
}

async function appendTurn(sb, convId, existing, userMsg, assistantMsg, extraMeta = {}) {
  const now = new Date().toISOString();
  const updated = [
    ...existing,
    { role: 'user',      content: userMsg,      ts: now, ...extraMeta },
    { role: 'assistant', content: assistantMsg, ts: now },
  ].slice(-(MAX_TURNS_IN_CONTEXT * 2));

  await sb
    .from('human_agent_conversations')
    .update({ messages: updated })
    .eq('id', convId);

  return updated;
}

async function updateMemory(sb, userId, patch) {
  await sb.from('human_agent_memory').update(patch).eq('user_id', userId);
}

async function createDevTicket(sb, userId, { description, context = {}, urgency = 'medium' }) {
  const { data } = await sb
    .from('human_agent_dev_tickets')
    .insert({ user_id: userId, description, context, urgency })
    .select('id')
    .single();
  return data?.id;
}

function buildClaudeHistory(messages) {
  return messages
    .slice(-(MAX_TURNS_IN_CONTEXT * 2))
    .map(m => ({ role: m.role, content: m.content }));
}

module.exports = {
  loadContext,
  ensureMemory,
  ensureTodayConversation,
  summarizeYesterdaySession,
  appendTurn,
  updateMemory,
  createDevTicket,
  buildClaudeHistory,
};
