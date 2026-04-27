'use strict';

const MAX_TURNS_IN_CONTEXT = 20; // last 20 turns sent to Claude
const MAX_RECENT_SESSIONS  = 3;  // last 3 session summaries loaded for context

async function loadContext(sb, userId) {
  const today = new Date().toISOString().split('T')[0];

  const [memRes, profileRes, subRes, todayRes, recentRes] = await Promise.all([
    sb.from('human_agent_memory').select('*').eq('user_id', userId).maybeSingle(),
    sb.from('profiles').select('name').eq('id', userId).maybeSingle(),
    sb.from('subscriptions').select('plan, status').eq('user_id', userId).eq('status', 'active').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    sb.from('human_agent_conversations').select('id, messages').eq('user_id', userId).eq('session_date', today).maybeSingle(),
    sb.from('human_agent_conversations').select('summary, session_date').eq('user_id', userId).lt('session_date', today).order('session_date', { ascending: false }).limit(MAX_RECENT_SESSIONS),
  ]);

  const memory   = memRes.data   || null;
  const todayConv = todayRes.data || null;
  const messages  = todayConv?.messages || [];

  return {
    memory,
    userName:         profileRes.data?.name   || '',
    plan:             subRes.data?.plan        || 'free',
    todayConvId:      todayConv?.id            || null,
    todayMessages:    messages,
    hasInteractedToday: messages.length > 0,
    recentSessions:   recentRes.data           || [],
  };
}

async function ensureMemory(sb, userId) {
  const { data } = await sb.from('human_agent_memory').select('id').eq('user_id', userId).maybeSingle();
  if (!data) {
    await sb.from('human_agent_memory').insert({ user_id: userId });
  }
}

async function ensureTodayConversation(sb, userId) {
  const today = new Date().toISOString().split('T')[0];
  const { data } = await sb
    .from('human_agent_conversations')
    .select('id, messages')
    .eq('user_id', userId)
    .eq('session_date', today)
    .maybeSingle();

  if (data) return data;

  const { data: created } = await sb
    .from('human_agent_conversations')
    .insert({ user_id: userId, session_date: today, messages: [] })
    .select('id, messages')
    .single();
  return created;
}

async function appendTurn(sb, convId, existing, userMsg, assistantMsg) {
  const now = new Date().toISOString();
  const updated = [
    ...existing,
    { role: 'user',      content: userMsg,      ts: now },
    { role: 'assistant', content: assistantMsg, ts: now },
  ].slice(-(MAX_TURNS_IN_CONTEXT * 2));

  await sb
    .from('human_agent_conversations')
    .update({ messages: updated })
    .eq('id', convId);

  return updated;
}

async function updateMemory(sb, userId, patch) {
  await sb
    .from('human_agent_memory')
    .update(patch)
    .eq('user_id', userId);
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
  appendTurn,
  updateMemory,
  createDevTicket,
  buildClaudeHistory,
};
