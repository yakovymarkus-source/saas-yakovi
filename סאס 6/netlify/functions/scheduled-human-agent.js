'use strict';
require('./_shared/env');

/**
 * scheduled-human-agent.js
 * Runs every hour. Finds users who were active recently but haven't opened
 * the app today, and queues a proactive check-in message via the
 * human_agent_conversations table (frontend picks it up on next open).
 *
 * Schedule: every hour (see netlify.toml)
 */

const { getAdminClient } = require('./_shared/supabase');

const CLAUDE_API = 'https://api.anthropic.com/v1/messages';
const MODEL      = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

const PROACTIVE_SCENARIOS = [
  {
    id: 'no_activity_today',
    // User was active in the last 7 days but NOT today
    query: `
      SELECT DISTINCT hm.user_id, p.name
      FROM human_agent_memory hm
      JOIN profiles p ON p.id = hm.user_id
      WHERE hm.onboarding_completed = true
        AND hm.user_id NOT IN (
          SELECT DISTINCT user_id FROM human_agent_conversations
          WHERE session_date = CURRENT_DATE
        )
        AND hm.user_id IN (
          SELECT DISTINCT user_id FROM human_agent_conversations
          WHERE session_date >= CURRENT_DATE - INTERVAL '7 days'
        )
      LIMIT 20
    `,
    trigger: 'inactivity',
  },
];

async function generateProactiveMessage(userName, genderPref, goals, trigger) {
  const name   = userName || 'חבר';
  const isFem  = genderPref === 'female';
  const goStr  = goals?.length ? `יעדים קיימים: ${goals.slice(0, 2).join(', ')}. ` : '';

  const systemPrompt = `אתה ${isFem ? 'שותפה עסקית' : 'שותף עסקי'} של ${name}. ${goStr}
שלח הודעה יזומה קצרה ואנושית (2-3 משפטים מקסימום). אל תחפור. אל תסביר מי אתה — הוא כבר מכיר אותך.`;

  const userPrompts = {
    inactivity: `המשתמש לא נכנס היום. שלח לו הודעה קצרה שתדרבן אותו לחזור ולהתקדם — ספציפי, חם, ישיר.`,
    goal_check: `עברה שבת מאז שהמשתמש הגדיר יעדים. שאל אותו בצורה קצרה איפה הוא עומד.`,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

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
        max_tokens: 200,
        system:     systemPrompt,
        messages:   [{ role: 'user', content: userPrompts[trigger] || userPrompts.inactivity }],
      }),
    });
    const data = await res.json().catch(() => ({}));
    return data.content?.find(b => b.type === 'text')?.text || null;
  } finally {
    clearTimeout(timer);
  }
}

exports.handler = async () => {
  // Only run between 08:00–21:00 Israel time (UTC+3)
  const hourUTC = new Date().getUTCHours();
  const hourIL  = (hourUTC + 3) % 24;
  if (hourIL < 8 || hourIL > 21) return { statusCode: 200, body: 'outside hours' };

  const sb = getAdminClient();
  let processed = 0;

  for (const scenario of PROACTIVE_SCENARIOS) {
    try {
      const { data: users, error } = await sb.rpc('exec_sql', { sql: scenario.query }).catch(() => ({ data: null }));

      // Fallback if exec_sql not available — use direct table query
      const targets = users || await (async () => {
        const today = new Date().toISOString().split('T')[0];
        const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];

        const { data: active } = await sb
          .from('human_agent_conversations')
          .select('user_id')
          .gte('session_date', sevenDaysAgo)
          .lt('session_date', today);

        const { data: todayActive } = await sb
          .from('human_agent_conversations')
          .select('user_id')
          .eq('session_date', today);

        const todaySet = new Set((todayActive || []).map(r => r.user_id));
        const candidates = (active || []).filter(r => !todaySet.has(r.user_id)).slice(0, 20);

        if (!candidates.length) return [];

        const ids = [...new Set(candidates.map(r => r.user_id))];
        const { data: memories } = await sb
          .from('human_agent_memory')
          .select('user_id, business_goals, gender_preference')
          .in('user_id', ids)
          .eq('onboarding_completed', true);

        const { data: profiles } = await sb
          .from('profiles')
          .select('id, name')
          .in('id', ids);

        return (memories || []).map(m => ({
          user_id:          m.user_id,
          name:             profiles?.find(p => p.id === m.user_id)?.name || '',
          business_goals:   m.business_goals,
          gender_preference: m.gender_preference,
        }));
      })();

      for (const user of targets) {
        try {
          const message = await generateProactiveMessage(
            user.name, user.gender_preference, user.business_goals, scenario.trigger
          );
          if (!message) continue;

          const today = new Date().toISOString().split('T')[0];
          const { data: conv } = await sb
            .from('human_agent_conversations')
            .select('id, messages')
            .eq('user_id', user.user_id)
            .eq('session_date', today)
            .maybeSingle();

          const existing = conv?.messages || [];
          const newMsg   = { role: 'assistant', content: message, ts: new Date().toISOString(), proactive: true };

          if (conv) {
            await sb.from('human_agent_conversations')
              .update({ messages: [...existing, newMsg] })
              .eq('id', conv.id);
          } else {
            await sb.from('human_agent_conversations')
              .insert({ user_id: user.user_id, session_date: today, messages: [newMsg] });
          }

          processed++;
        } catch (userErr) {
          console.error('[scheduled-human-agent] user error:', user.user_id, userErr.message);
        }
      }
    } catch (scenarioErr) {
      console.error('[scheduled-human-agent] scenario error:', scenarioErr.message);
    }
  }

  console.log(`[scheduled-human-agent] processed ${processed} users`);
  return { statusCode: 200, body: JSON.stringify({ processed }) };
};
