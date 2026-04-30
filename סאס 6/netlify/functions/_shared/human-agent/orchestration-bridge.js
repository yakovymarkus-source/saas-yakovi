'use strict';

const AGENT_ENDPOINT = {
  research:  'research-start',
  strategy:  'strategy-start',
  execution: 'execution-start',
  qa:        'qa-start',
  analysis:  'analysis-start',
};

// Claude tool definitions
const TOOLS = [
  {
    name: 'trigger_agent',
    description: 'הפעל אחד מהסוכנים הקיימים במערכת. השתמש בזה כשהמשתמש מבקש לבצע מחקר, לבנות אסטרטגיה, ליצור תוכן, לבדוק איכות, או לנתח נתונים.',
    input_schema: {
      type: 'object',
      properties: {
        agent: {
          type: 'string',
          enum: ['research', 'strategy', 'execution', 'qa', 'analysis'],
          description: 'הסוכן שיש להפעיל',
        },
        task: {
          type: 'string',
          description: 'תיאור המשימה הספציפית שהסוכן צריך לבצע',
        },
      },
      required: ['agent', 'task'],
    },
  },
  {
    name: 'save_user_data',
    description: 'שמור מידע על המשתמש בזיכרון הסוכן: יעדים, פרטים אישיים, תאריך לידה, סגנון תקשורת, הצלחות. השתמש בזה כשהמשתמש מספר על עצמו, מגדיר יעדים, מספר על הצלחה, או כשאתה מזהה דפוס תקשורת.',
    input_schema: {
      type: 'object',
      properties: {
        goals:              { type: 'array',  items: { type: 'string' }, description: 'יעדים עסקיים מעודכנים (רשימה מלאה)' },
        personal_note:      { type: 'string', description: 'פרט אישי שהמשתמש שיתף — משפחה, תחביב, מצב, ערך מרכזי' },
        birth_date:         { type: 'string', description: 'תאריך לידה בפורמט YYYY-MM-DD' },
        gender_preference:  { type: 'string', enum: ['male', 'female'], description: 'העדפת מגדר הסוכן' },
        onboarding_done:    { type: 'boolean', description: 'סמן true כשהמשתמש השלים את שאלות הכניסה' },
        success:            { type: 'string', description: 'הצלחה או הישג שהמשתמש דיווח עליו — שמור כדי לחגוג ולחזור אליו' },
        communication_hint: { type: 'string', description: 'תובנה על סגנון התקשורת המועדף של המשתמש (למשל: מעדיף תשובות קצרות, רגיש לביקורת, אוהב הומור)' },
      },
    },
  },
  {
    name: 'create_dev_ticket',
    description: 'פתח פנייה טכנית ליעקב המפתח. השתמש רק אחרי שהמשתמש אישר שרוצה לשלוח פנייה.',
    input_schema: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'תיאור הבעיה או הבקשה' },
        urgency:     { type: 'string', enum: ['low', 'medium', 'high'], description: 'רמת דחיפות' },
        error_info:  { type: 'string', description: 'פרטים טכניים — שגיאות, מה ניסה המשתמש' },
      },
      required: ['description'],
    },
  },
  {
    name: 'get_performance_data',
    description: 'שלוף נתוני ביצועים עדכניים מהמערכת (קמפיינים, לידים, אנליטיקה).',
    input_schema: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: ['today', 'week', 'month'], description: 'תקופה לסקירה' },
      },
    },
  },
  {
    name: 'highlight_element',
    description: 'הדגש אלמנט בממשק המשתמש בנצנוץ כדי להכוון אותו. השתמש כשמסביר איפה ללחוץ או מה לעשות.',
    input_schema: {
      type: 'object',
      properties: {
        selector:    { type: 'string', description: 'CSS selector של האלמנט (למשל: #btn-new-campaign, .nav-strategy)' },
        label:       { type: 'string', description: 'תיאור קצר של מה האלמנט עושה' },
        duration_ms: { type: 'number', description: 'כמה זמן להדגיש במילישניות (ברירת מחדל: 4000)' },
      },
      required: ['selector', 'label'],
    },
  },
  {
    name: 'navigate_to',
    description: 'נווט את המשתמש לדף מסוים במערכת. השתמש כשהמשתמש צריך לעבור לאזור אחר.',
    input_schema: {
      type: 'object',
      properties: {
        page:    { type: 'string', enum: ['dashboard', 'campaigns', 'research', 'strategy', 'execution', 'qa', 'analysis', 'leads', 'account', 'integrations', 'billing'], description: 'הדף שיש לנווט אליו' },
        message: { type: 'string', description: 'הסבר קצר למה אנחנו עוברים לשם' },
      },
      required: ['page'],
    },
  },
];

async function executeTool(name, input, { sb, userId, appUrl, internalSecret }) {
  switch (name) {
    case 'trigger_agent':
      return runAgent(input, { appUrl, internalSecret, userId });
    case 'save_user_data':
      return saveUserData(input, { sb, userId });
    case 'create_dev_ticket':
      return createTicket(input, { sb, userId });
    case 'get_performance_data':
      return fetchPerformance(input, { sb, userId });
    case 'highlight_element':
      return broadcastFrontendEvent(userId, { type: 'highlight', selector: input.selector, label: input.label, duration_ms: input.duration_ms || 4000 }, { sb });
    case 'navigate_to':
      return broadcastFrontendEvent(userId, { type: 'navigate', page: input.page, message: input.message || '' }, { sb });
    default:
      return { ok: false, error: `כלי לא מוכר: ${name}` };
  }
}

async function runAgent({ agent, task }, { appUrl, internalSecret, userId }) {
  const endpoint = AGENT_ENDPOINT[agent];
  if (!endpoint) return { ok: false, error: 'סוכן לא מוכר' };

  try {
    const res = await fetch(`${appUrl}/.netlify/functions/${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': internalSecret || '',
      },
      body: JSON.stringify({ task_description: task, triggered_by: 'human_agent', user_id: userId }),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: true, agent, jobId: data.jobId, message: `סוכן ${agent} הופעל בהצלחה` };
  } catch (err) {
    return { ok: false, error: `שגיאה בהפעלת הסוכן: ${err.message}` };
  }
}

async function saveUserData(input, { sb, userId }) {
  const patch = {};

  if (input.goals)             patch.business_goals      = input.goals;
  if (input.birth_date)        patch.birth_date           = input.birth_date;
  if (input.gender_preference) patch.gender_preference    = input.gender_preference;
  if (input.onboarding_done)   patch.onboarding_completed = true;

  const needsArrayRead = input.personal_note || input.success || input.communication_hint;

  if (Object.keys(patch).length || needsArrayRead) {
    const { data } = await sb
      .from('human_agent_memory')
      .select('personal_notes, successes, communication_style')
      .eq('user_id', userId)
      .maybeSingle();

    if (input.personal_note) {
      patch.personal_notes = [...(data?.personal_notes || []), input.personal_note];
    }
    if (input.success) {
      patch.successes = [
        ...(data?.successes || []),
        { text: input.success, ts: new Date().toISOString() },
      ];
    }
    if (input.communication_hint) {
      const existing = data?.communication_style || {};
      const hints = Array.isArray(existing.hints) ? existing.hints : [];
      patch.communication_style = { ...existing, hints: [...hints, input.communication_hint] };
    }

    await sb.from('human_agent_memory').update(patch).eq('user_id', userId);
  }

  return { ok: true, message: 'המידע נשמר בזיכרון' };
}

async function createTicket({ description, urgency, error_info }, { sb, userId }) {
  const { data } = await sb
    .from('human_agent_dev_tickets')
    .insert({ user_id: userId, description, urgency: urgency || 'medium', context: { error_info: error_info || '' } })
    .select('id')
    .single();
  return { ok: true, ticketId: data?.id, message: 'הפנייה נשלחה ליעקב המפתח בהצלחה' };
}

async function broadcastFrontendEvent(userId, payload, { sb }) {
  // Publishes to Supabase Realtime channel — frontend subscribes to agent_events:{userId}
  try {
    await sb.channel(`agent_events:${userId}`).send({
      type:    'broadcast',
      event:   payload.type,
      payload: { ...payload, userId, ts: new Date().toISOString() },
    });
    return { ok: true, event: payload.type };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function fetchPerformance({ period = 'week' }, { sb, userId }) {
  const { data } = await sb
    .from('api_cache')
    .select('source, payload, updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(5);

  if (!data?.length) return { ok: true, message: 'אין נתוני ביצועים זמינים כרגע — מחכה לסנכרון' };
  return { ok: true, period, data };
}

module.exports = { TOOLS, executeTool };
