/**
 * campaigner-chat.js — Contextual AI chat for CampaignAI
 *
 * POST /campaigner-chat
 * Headers: Authorization: Bearer <supabase-jwt>
 * Body: { message: string, history?: [{role:'user'|'assistant', content:string}] }
 *
 * Returns: { reply: string, quickActions: string[], data?: object }
 *
 * Intelligence pipeline:
 *   1. Authenticate user
 *   2. Load live stats from api_cache (no new API calls — cache is always fresh)
 *   3. Load latest analysis + integration status from DB
 *   4. Detect intent from message
 *   5. Run decision engine on real metrics
 *   6. Generate specific, data-driven Hebrew response
 *   7. Return reply + contextual quick action chips
 */

'use strict';

const { ok, fail }                              = require('./_shared/http');
const { createRequestContext, buildLogPayload } = require('./_shared/observability');
const { writeRequestLog, getAdminClient }       = require('./_shared/supabase');
const { requireAuth }                           = require('./_shared/auth');
const { AppError }                              = require('./_shared/errors');
const { parseJsonBody }                         = require('./_shared/request');
const { analyze }                               = require('./_shared/decision-engine');

// ── Intent detection ──────────────────────────────────────────────────────────
const INTENT_PATTERNS = [
  { intent: 'overview',  patterns: /\b(איך|ביצועים|סקירה|סטטוס|מצב|overview|status|how am|doing)\b/i },
  { intent: 'budget',    patterns: /\b(תקציב|budget|הזזה|חלוקה|הקצאה|shift|allocat|reallocat)\b/i },
  { intent: 'top_ads',   patterns: /\b(מודעות|טובות|top|best|ads|קמפיין|campaign|ניצחון|נצח)\b/i },
  { intent: 'tracking',  patterns: /\b(tracking|טראקינג|מעקב|פיקסל|pixel|pixel|audit|בדיקה)\b/i },
  { intent: 'roas',      patterns: /\b(roas|החזר|return|spend|תשואה)\b/i },
  { intent: 'ctr',       patterns: /\b(ctr|קליקים|clicks|חשיפות|impressions)\b/i },
  { intent: 'recs',      patterns: /\b(המלצ|מה לעש|recommend|suggest|what should|תעשה|עצה)\b/i },
  { intent: 'integrations', patterns: /\b(חיבור|integration|connected|גוגל|מטא|google|meta|ga4)\b/i },
];

function detectIntent(message) {
  const lower = message.toLowerCase();
  for (const { intent, patterns } of INTENT_PATTERNS) {
    if (patterns.test(lower)) return intent;
  }
  return 'overview';
}

// ── Context builder ───────────────────────────────────────────────────────────
async function buildContext(userId) {
  const sb = getAdminClient();
  const now = new Date().toISOString();

  const [integrationsRes, cacheRes, analysisRes, profileRes] = await Promise.all([
    sb.from('user_integrations')
      .select('provider, account_name, connection_status, last_sync_at, last_error')
      .eq('user_id', userId),
    sb.from('api_cache')
      .select('source, payload, fresh_until, updated_at')
      .eq('user_id', userId)
      .gte('stale_until', now),
    sb.from('analysis_results')
      .select('scores, metrics, confidence, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    sb.from('profiles')
      .select('name')
      .eq('id', userId)
      .maybeSingle(),
  ]);

  const integrations = integrationsRes.data || [];

  // Build a map of latest cached stats per provider
  const statsByProvider = {};
  for (const row of (cacheRes.data || [])) {
    if (!statsByProvider[row.source]) {
      statsByProvider[row.source] = { ...row.payload, fetchedAt: row.updated_at };
    }
  }

  return {
    integrations,
    statsByProvider,
    recentAnalysis: analysisRes.data,
    profileName:    profileRes.data?.name || 'משתמש',
  };
}

// ── Metric aggregators ─────────────────────────────��──────────────────────────
function sumMetrics(metricsArray) {
  return (metricsArray || []).reduce((acc, r) => ({
    impressions:  acc.impressions  + (r.impressions       || 0),
    clicks:       acc.clicks       + (r.clicks            || 0),
    spend:        acc.spend        + (r.spend || (r.costMicros / 1e6) || 0),
    conversions:  acc.conversions  + (r.conversions       || 0),
    revenue:      acc.revenue      + (r.conversionsValue  || r.totalRevenue || 0),
    reach:        acc.reach        + (r.reach             || 0),
    sessions:     acc.sessions     + (r.sessions          || 0),
  }), { impressions: 0, clicks: 0, spend: 0, conversions: 0, revenue: 0, reach: 0, sessions: 0 });
}

function formatNum(n) { return Number(n || 0).toLocaleString('he-IL', { maximumFractionDigits: 0 }); }
function fmtUSD(n)    { return `$${Number(n || 0).toFixed(2)}`; }
function fmtPct(n)    { return `${(Number(n || 0) * 100).toFixed(2)}%`; }

// ── Response generators ─────────────────────────────────��─────────────────────

function generateOverviewResponse(context) {
  const { integrations, statsByProvider, recentAnalysis, profileName } = context;
  const connected = integrations.filter(i => i.connection_status === 'active');

  if (!connected.length) {
    return {
      reply: `היי ${profileName}! 👋\n\nעדיין לא חיברת אינטגרציות. כדי לנתח ביצועים, תצטרך לחבר לפחות אחד מהחשבונות הבאים:\n\n🟢 **Google Ads** — קמפיינים בחיפוש ו-Display\n🔵 **Meta Ads** — פייסבוק ואינסטגרם\n📈 **GA4** — תנועת האתר\n\nעבור לדף **אינטגרציות** ולחץ "חבר".`,
      quickActions: ['בדוק את האינטגרציות', 'מה זה ROAS?', 'איך עובד הניתוח?'],
    };
  }

  const sections = [];
  let globalRaw = { impressions: 0, clicks: 0, spend: 0, conversions: 0, revenue: 0, sessions: 0, bounceRate: 0, frequency: 0 };

  for (const integ of connected) {
    const data = statsByProvider[integ.provider];
    if (!data) {
      sections.push(`**${providerLabel(integ.provider)}:** אין נתונים בקאש — לחץ "רענן" בדשבורד.`);
      continue;
    }
    const totals = sumMetrics(Array.isArray(data.metrics) ? data.metrics : []);
    globalRaw.impressions  += totals.impressions;
    globalRaw.clicks       += totals.clicks;
    globalRaw.spend        += totals.spend;
    globalRaw.conversions  += totals.conversions;
    globalRaw.revenue      += totals.revenue;
    globalRaw.sessions     += totals.sessions;

    const ctr  = totals.impressions > 0 ? totals.clicks / totals.impressions : 0;
    const roas = totals.spend > 0 ? totals.revenue / totals.spend : null;

    let line = `**${providerLabel(integ.provider)}:**\n`;
    line += `  • חשיפות: ${formatNum(totals.impressions)} | קליקים: ${formatNum(totals.clicks)} | CTR: ${fmtPct(ctr)}\n`;
    line += `  • הוצאה: ${fmtUSD(totals.spend)} | המרות: ${formatNum(totals.conversions)}`;
    if (roas !== null) line += ` | ROAS: ${roas.toFixed(2)}x`;
    sections.push(line);
  }

  // Run decision engine on global metrics
  const engineResult = globalRaw.clicks > 0 ? analyze(globalRaw) : null;

  let reply = `היי ${profileName}! הנה סקירת הביצועים שלך:\n\n`;
  reply += sections.join('\n\n') + '\n\n';

  if (engineResult) {
    const top = engineResult.issues[0];
    const action = engineResult.prioritizedActions[0];
    const confidence = Math.round(engineResult.confidence * 100);
    reply += `🔍 **ניתוח האלגוריתם (ביטחון ${confidence}%):**\n`;
    reply += `  האות החזק ביותר: **${top.reason}**\n`;
    if (top.evidence?.length) reply += `  עדות: ${top.evidence.join(' | ')}\n`;
    reply += `\n⚡ **הפעולה הדחופה ביותר:**\n  ${action.title}\n  _${action.why}_\n  תוצאה צפויה: ${action.expectedImpact}`;
  } else if (recentAnalysis) {
    const score = recentAnalysis.scores?.overall || 0;
    reply += `📊 **ניתוח אחרון:** ציון ${score}/100 | ביטחון ${recentAnalysis.confidence}%`;
  } else {
    reply += `💡 **טיפ:** הרץ ניתוח על קמפיין כדי לקבל המלצות מפורטות.`;
  }

  return { reply, quickActions: ['הצע הזזת תקציב', 'נתח את הקמפיינים שלי', 'בדוק את ה-Tracking'] };
}

function generateBudgetResponse(context) {
  const { statsByProvider, integrations, profileName } = context;
  const connected = integrations.filter(i => i.connection_status === 'active');

  if (!connected.length) {
    return {
      reply: 'אין אינטגרציות פעילות לניתוח תקציב. חבר קודם Google Ads או Meta Ads.',
      quickActions: ['חבר אינטגרציה', 'מה זה ROAS?'],
    };
  }

  const analysis = [];
  for (const integ of connected) {
    const data = statsByProvider[integ.provider];
    if (!data?.metrics) continue;
    const metrics = Array.isArray(data.metrics) ? data.metrics : [];

    // Sort campaigns by ROAS desc
    const withRoas = metrics
      .map(m => ({
        name:  m.campaignName || m.sessionCampaignName || 'Unknown',
        spend: m.spend || (m.costMicros / 1e6) || 0,
        conversions: m.conversions || 0,
        revenue: m.conversionsValue || m.totalRevenue || 0,
        roas: (m.spend || (m.costMicros / 1e6) || 0) > 0
          ? ((m.conversionsValue || m.totalRevenue || 0) / (m.spend || (m.costMicros / 1e6)))
          : null,
      }))
      .filter(m => m.spend > 0)
      .sort((a, b) => (b.roas ?? -1) - (a.roas ?? -1));

    if (!withRoas.length) continue;
    const label = providerLabel(integ.provider);
    const top    = withRoas.slice(0, 2);
    const bottom = withRoas.slice(-2).filter(m => !top.includes(m));

    let section = `**${label} — הצעות תקציב:**\n`;
    if (top.length) {
      section += `  🟢 **הגדל תקציב ב-20%:**\n`;
      top.forEach(c => { section += `    • ${c.name} — ROAS: ${c.roas ? c.roas.toFixed(2) + 'x' : 'N/A'} | הוצאה: ${fmtUSD(c.spend)}\n`; });
    }
    if (bottom.length) {
      section += `  🔴 **הפחת תקציב ב-30%:**\n`;
      bottom.forEach(c => { section += `    • ${c.name} — ROAS: ${c.roas ? c.roas.toFixed(2) + 'x' : 'N/A'} | הוצאה: ${fmtUSD(c.spend)}\n`; });
    }
    analysis.push(section);
  }

  if (!analysis.length) {
    return {
      reply: 'אין מספיק נתוני קמפיינים לניתוח תקציב. נסה לרענן את הנתונים בדשבורד.',
      quickActions: ['רענן נתונים', 'נתח ביצועים כלליים'],
    };
  }

  const reply = `💰 **ניתוח תקציב — ${profileName}:**\n\nהמלצות מבוססות על ROAS ו-CPA בפועל:\n\n${analysis.join('\n')}\n\n📌 **כלל האצבע:** הגדל תקציב בקמפיינים עם ROAS > 2x, הפחת ב-ROAS < 1x, עצור ב-ROAS = 0.`;
  return { reply, quickActions: ['נתח ביצועים כלליים', 'בדוק CTR', 'מה הפעולה הדחופה ביותר?'] };
}

function generateTopAdsResponse(context) {
  const { statsByProvider, integrations } = context;
  const connected = integrations.filter(i => i.connection_status === 'active');

  const sections = [];
  for (const integ of connected) {
    const data = statsByProvider[integ.provider];
    if (!data?.metrics) continue;
    const metrics = Array.isArray(data.metrics) ? data.metrics : [];

    const sorted = metrics
      .map(m => ({
        name:        m.campaignName || m.sessionCampaignName || 'Unknown',
        impressions: m.impressions || 0,
        clicks:      m.clicks || 0,
        spend:       m.spend || (m.costMicros / 1e6) || 0,
        conversions: m.conversions || 0,
        ctr:         (m.impressions || 0) > 0 ? (m.clicks || 0) / m.impressions : 0,
      }))
      .filter(m => m.impressions > 0)
      .sort((a, b) => b.conversions - a.conversions || b.ctr - a.ctr)
      .slice(0, 3);

    if (!sorted.length) continue;
    const label = providerLabel(integ.provider);
    let section = `**${label} — טופ 3 קמפיינים:**\n`;
    sorted.forEach((c, i) => {
      section += `  ${i + 1}. **${c.name}**\n`;
      section += `     CTR: ${fmtPct(c.ctr)} | המרות: ${formatNum(c.conversions)} | הוצאה: ${fmtUSD(c.spend)}\n`;
    });
    sections.push(section);
  }

  if (!sections.length) {
    return {
      reply: 'אין נתוני קמפיינים זמינים. ודא שהאינטגרציות מחוברות ורענן את הנתונים.',
      quickActions: ['בדוק אינטגרציות', 'רענן נתונים'],
    };
  }

  const reply = `📈 **הקמפיינים המובילים שלך:**\n\n${sections.join('\n')}\n\n💡 **המלצה:** מיקד יצירה חדשה בסגנון הקמפיין המוביל ובדוק אם אפשר לשכפל אותו לקהל Lookalike.`;
  return { reply, quickActions: ['הצע הזזת תקציב', 'נתח ביצועים כלליים', 'מה הפעולה הדחופה ביותר?'] };
}

function generateTrackingResponse(context) {
  const { integrations } = context;
  const providers = { google_ads: '🟢 Google Ads', ga4: '📈 GA4', meta: '🔵 Meta Ads' };
  const lines = [];

  for (const [prov, label] of Object.entries(providers)) {
    const integ = integrations.find(i => i.provider === prov);
    if (!integ) {
      lines.push(`  ❌ **${label}:** לא מחובר`);
    } else if (integ.connection_status === 'error') {
      lines.push(`  ⚠️ **${label}:** שגיאה — ${integ.last_error || 'שגיאה לא ידועה'}`);
    } else if (integ.connection_status === 'expired') {
      lines.push(`  🔄 **${label}:** Token פג — יש לחבר מחדש`);
    } else {
      const syncTime = integ.last_sync_at ? new Date(integ.last_sync_at).toLocaleString('he-IL') : 'לא ידוע';
      lines.push(`  ✅ **${label}:** תקין (סנכרון: ${syncTime})`);
    }
  }

  const issues = integrations.filter(i => i.connection_status !== 'active').length;
  const pixelNote = `\n\n📊 **Meta Pixel:** ${integrations.find(i => i.provider === 'meta') ? 'מוגדר ברמת המערכת.' : 'מחייב חיבור Meta Ads קודם.'}`;
  const action = issues > 0 ? `\n\n🚨 יש ${issues} בעיות שדורשות טיפול. עבור לדף **אינטגרציות** לתיקון.` : `\n\n✅ כל המעקב תקין! הנתונים זורמים כרגיל.`;

  const reply = `🔍 **סטטוס Tracking:**\n\n${lines.join('\n')}${pixelNote}${action}`;
  return { reply, quickActions: ['פתח עמוד אינטגרציות', 'נתח ביצועים כלליים', 'הצע הזזת תקציב'] };
}

function generateROASResponse(context) {
  const { statsByProvider, integrations } = context;
  const connected = integrations.filter(i => i.connection_status === 'active');
  const sections = [];
  let totalSpend = 0, totalRevenue = 0;

  for (const integ of connected) {
    const data = statsByProvider[integ.provider];
    if (!data?.metrics) continue;
    const totals = sumMetrics(Array.isArray(data.metrics) ? data.metrics : []);
    totalSpend   += totals.spend;
    totalRevenue += totals.revenue;
    const roas = totals.spend > 0 ? totals.revenue / totals.spend : null;
    const label = providerLabel(integ.provider);
    sections.push(`  **${label}:** הוצאה ${fmtUSD(totals.spend)} | הכנסה ${fmtUSD(totals.revenue)} | ROAS ${roas ? roas.toFixed(2) + 'x' : 'N/A'}`);
  }

  const globalRoas = totalSpend > 0 ? totalRevenue / totalSpend : null;
  const verdict = globalRoas === null ? 'לא ניתן לחשב' : globalRoas >= 3 ? '🟢 מצוין!' : globalRoas >= 1.5 ? '🟡 סביר, יש מקום לשיפור' : '🔴 מתחת לסף הרווחיות';

  const reply = `📊 **ניתוח ROAS:**\n\n${sections.join('\n')}\n\n**ROAS כולל: ${globalRoas ? globalRoas.toFixed(2) + 'x' : 'N/A'} — ${verdict}**\n\nהסף המינימלי לרווחיות הוא 1.5x. ROAS > 3x מצדיק סקייל.`;
  return { reply, quickActions: ['הצע הזזת תקציב', 'נתח את הקמפיינים שלי', 'נתח ביצועים כלליים'] };
}

function generateCTRResponse(context) {
  const { statsByProvider, integrations } = context;
  const connected = integrations.filter(i => i.connection_status === 'active');
  const sections = [];

  for (const integ of connected) {
    const data = statsByProvider[integ.provider];
    if (!data?.metrics) continue;
    const metrics = Array.isArray(data.metrics) ? data.metrics : [];
    const totals = sumMetrics(metrics);
    const ctr = totals.impressions > 0 ? totals.clicks / totals.impressions : 0;
    const grade = ctr > 0.03 ? '🟢 מצוין' : ctr > 0.012 ? '🟡 בינוני' : ctr > 0.008 ? '🟠 נמוך' : '🔴 קריטי';
    sections.push(`  **${providerLabel(integ.provider)}:** CTR ${fmtPct(ctr)} ${grade}`);
  }

  const reply = `📊 **ניתוח CTR:**\n\n${sections.join('\n')}\n\n📌 **ספים:**\n  • > 3% — מצוין\n  • 1.2–3% — בינוני (שפר קריאייטיב)\n  • < 0.8% — קריטי (החלף קריאייטיב מיד)\n\nCTR נמוך = המסר לא מדויק לקהל או שהקריאייטיב שחוק.`;
  return { reply, quickActions: ['הצע הזזת תקציב', 'נתח הביצועים הכלליים', 'מה הפעולה הדחופה?'] };
}

function generateIntegrationsResponse(context) {
  return generateTrackingResponse(context);
}

function generateRecsResponse(context) {
  const { statsByProvider, integrations, recentAnalysis } = context;
  const connected = integrations.filter(i => i.connection_status === 'active');

  // Aggregate all live metrics
  let globalRaw = { impressions: 0, clicks: 0, spend: 0, conversions: 0, revenue: 0, sessions: 0, bounceRate: 0, frequency: 0 };
  for (const integ of connected) {
    const data = statsByProvider[integ.provider];
    if (!data?.metrics) continue;
    const t = sumMetrics(Array.isArray(data.metrics) ? data.metrics : []);
    globalRaw.impressions += t.impressions;
    globalRaw.clicks      += t.clicks;
    globalRaw.spend       += t.spend;
    globalRaw.conversions += t.conversions;
    globalRaw.revenue     += t.revenue;
    globalRaw.sessions    += t.sessions;
  }

  if (globalRaw.clicks === 0) {
    const recs = (recentAnalysis?.metrics) ? [] : [];
    return {
      reply: 'אין עדיין נתונים חיים להמלצות. חבר אינטגרציה והרץ ניתוח כדי לקבל המלצות מבוססות נתונים.',
      quickActions: ['חבר אינטגרציה', 'הרץ ניתוח'],
    };
  }

  const result = analyze(globalRaw);
  const actions = result.prioritizedActions.slice(0, 3);
  const confidence = Math.round(result.confidence * 100);

  let reply = `🎯 **המלצות מותאמות אישית (ביטחון ${confidence}%):**\n\n`;
  actions.forEach((a, i) => {
    reply += `${i + 1}. **${a.title}**\n`;
    reply += `   📌 _${a.why}_\n`;
    reply += `   ✅ תוצאה צפויה: ${a.expectedImpact}\n`;
    reply += `   📊 ציון עדיפות: ${a.priorityScore}/10\n\n`;
  });
  reply += `🔍 **האות הדומיננטי:** ${result.issues[0].reason}`;

  return { reply, quickActions: ['נתח ביצועים כלליים', 'הצע הזזת תקציב', 'בדוק CTR'] };
}

// ── Helper ─────────────────────────��──────────────────────────────���───────────
function providerLabel(provider) {
  return { google_ads: 'Google Ads', ga4: 'Google Analytics 4', meta: 'Meta Ads' }[provider] || provider;
}

// ── Router ─────────────────────────────────────────────────────────���──────────
function generateResponse(intent, context) {
  switch (intent) {
    case 'overview':      return generateOverviewResponse(context);
    case 'budget':        return generateBudgetResponse(context);
    case 'top_ads':       return generateTopAdsResponse(context);
    case 'tracking':      return generateTrackingResponse(context);
    case 'roas':          return generateROASResponse(context);
    case 'ctr':           return generateCTRResponse(context);
    case 'recs':          return generateRecsResponse(context);
    case 'integrations':  return generateIntegrationsResponse(context);
    default:              return generateOverviewResponse(context);
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  const context = createRequestContext(event, 'campaigner-chat');

  try {
    if (event.httpMethod !== 'POST') {
      throw new AppError({ code: 'METHOD_NOT_ALLOWED', userMessage: 'Method not allowed', devMessage: 'Use POST', status: 405 });
    }

    const user = await requireAuth(event, context.functionName, context);
    const body = parseJsonBody(event, { fallback: {}, allowEmpty: false, devMessage: 'Missing message' });

    const message = String(body.message || '').trim();
    if (!message) {
      throw new AppError({ code: 'BAD_REQUEST', userMessage: 'ההודעה ריקה', devMessage: 'message is required', status: 400 });
    }
    if (message.length > 2000) {
      throw new AppError({ code: 'BAD_REQUEST', userMessage: 'ההודעה ארוכה מדי', devMessage: 'message > 2000 chars', status: 400 });
    }

    // Build context from DB
    const chatContext = await buildContext(user.id);

    // Detect intent + generate response
    const intent  = detectIntent(message);
    const { reply, quickActions } = generateResponse(intent, chatContext);

    await writeRequestLog(buildLogPayload(context, 'info', 'campaigner_chat_response', {
      user_id: user.id,
      intent,
      providers_connected: chatContext.integrations.filter(i => i.connection_status === 'active').length,
    }));

    return ok({ reply, quickActions, intent }, context.requestId);

  } catch (error) {
    await writeRequestLog(buildLogPayload(context, 'error', error.message || 'campaigner_chat_failed', {
      code: error.code || 'INTERNAL_ERROR',
    })).catch(() => {});
    return fail(error, context.requestId);
  }
};
