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

const { ok, fail, options }                     = require('./_shared/http');
const { createRequestContext, buildLogPayload } = require('./_shared/observability');
const { writeRequestLog, getAdminClient }       = require('./_shared/supabase');
const { requireAuth }                           = require('./_shared/auth');
const { AppError }                              = require('./_shared/errors');
const { parseJsonBody }                         = require('./_shared/request');
const { sanitiseText }                          = require('./_shared/validation');
const { analyze }                               = require('./_shared/decision-engine');
const { dictionary }                            = require('./_shared/dictionary');
const { loadUserMemory, deriveAdaptiveContext, updateIntelligenceFromInteraction } = require('./_shared/user-intelligence');
const { detectBeginnerState, generateBeginnerOverride, appendBeginnerAddendum, resolveProgressUpdate, persistMilestoneProgress } = require('./_shared/beginner-mode');
const { loadStrategyMemory } = require('./_shared/learning-engine');
const { loadBusinessProfile, upsertBusinessProfile, scoreCompletion, formatProfileSummary, buildNextProfileQuestion } = require('./_shared/business-profile');
const { computeUnitEconomics, computeFunnelEconomics, cplStatusLabel, roasLabel } = require('./_shared/revenue-calculator');
const { loadRunningTests, buildNextTestSuggestion, formatTestCard } = require('./_shared/ab-test-tracker');
const { generateAdCopy, formatCopyCard } = require('./_shared/ad-copy-generator');
const { extractProfileAnswer } = require('./_shared/profile-intake-extractor');
const { orchestrate, CAPABILITIES }     = require('./_shared/orchestrator');

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
  { intent: 'trends',    patterns: /\b(טרנד|מגמה|שיפור|ירידה|trend|progress|היסטוריה|לאורך זמן|תקופה|שינוי|למידה|פרי|כיוון)\b/i },
  { intent: 'business',  patterns: /\b(עסק|פרופיל|מה אני מוכר|מחיר שלי|קהל יעד|הצעה שלי|business|profile|offer)\b/i },
  { intent: 'economics', patterns: /\b(כלכלה|CAC|LTV|CPL|cac|ltv|cpl|עלות ליד|break.?even|רווחיות|כמה להמיר|payback|economics|feasib)\b/i },
  { intent: 'test',      patterns: /\b(בדיקה|a\/b|ab test|וריאציה|ניסוי|מה לבדוק|hypothesis|variant|control)\b/i },
  { intent: 'copy',      patterns: /\b(כתוב|קופי|copy|מודעה|ad text|creative text|כותרת|headline|טקסט|מסר|נוסח)\b/i },
  { intent: 'creative',  patterns: /\b(קריאייטיב|creative brief|ויזואל|visual|עיצוב מודעה|תמונה למודעה|creative|brief|מה לשים בתמונה|תמונה לקמפיין|image prompt)\b/i },
  { intent: 'landing',   patterns: /\b(דף נחיתה|landing page|LP|לנדינג|עמוד נחיתה|לנד)\b/i },
  { intent: 'visual',    patterns: /\b(generate html|צור html|html|visual asset|נכס ויזואלי|ad.?card|כרטיס מודעה|באנר מודעה|banner ad|צור באנר)\b/i },
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

  const [integrationsRes, cacheRes, analysisRes, profileRes, memoryRaw, strategyMemory, businessProfile, runningTests] = await Promise.all([
    sb.from('user_integrations')
      .select('provider, account_name, connection_status, last_sync_at, last_error')
      .eq('user_id', userId),
    sb.from('api_cache')
      .select('source, payload, fresh_until, updated_at')
      .eq('user_id', userId)
      .gte('stale_until', now),
    sb.from('analysis_results')
      .select('scores, metrics, bottlenecks, confidence, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    sb.from('profiles')
      .select('name')
      .eq('id', userId)
      .maybeSingle(),
    loadUserMemory(userId),
    loadStrategyMemory(userId, null),  // Phase 4F: most recent campaign strategy
    loadBusinessProfile(userId),       // Phase 4G: static business facts
    loadRunningTests(userId),          // Phase 4G: active A/B tests
  ]);

  const integrations = integrationsRes.data || [];

  // Build a map of latest cached stats per provider
  const statsByProvider = {};
  for (const row of (cacheRes.data || [])) {
    if (!statsByProvider[row.source]) {
      statsByProvider[row.source] = { ...row.payload, fetchedAt: row.updated_at };
    }
  }

  // Compute global raw metrics for intelligence update and adaptive shaping
  const allConnected = integrations.filter(i => i.connection_status === 'active');
  const globalRaw = { impressions: 0, clicks: 0, spend: 0, conversions: 0, revenue: 0, sessions: 0 };
  for (const integ of allConnected) {
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

  return {
    integrations,
    statsByProvider,
    recentAnalysis:  analysisRes.data,
    profileName:     profileRes.data?.name || 'משתמש',
    adaptive:        deriveAdaptiveContext(memoryRaw),
    memoryRaw,                               // raw loadUserMemory() map — needed by buildMarketingMemory
    globalRaw,
    strategyMemory:  strategyMemory || null,  // Phase 4F
    businessProfile: businessProfile || null, // Phase 4G
    runningTests:    runningTests    || [],   // Phase 4G
    userId,                                  // Phase 4H: needed for intake extraction saves
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

// ── Dictionary helpers ────────────────────────────────────────────────────────
function dictLabel(key)   { return dictionary[key]?.simple_label            || key; }
function dictSummary(key) { return dictionary[key]?.simple_summary          || ''; }
function dictAction(key)  { return dictionary[key]?.first_action            || ''; }
function dictDef(key)     { return dictionary[key]?.learn_more?.definition  || ''; }

/** Format an enriched engine issue in plain Hebrew — no English jargon */
function formatIssueBlock(issue) {
  const label   = issue.simple_label   || dictLabel(issue.dict_key)   || issue.reason;
  const summary = issue.simple_summary || dictSummary(issue.dict_key) || '';
  const action  = issue.first_action   || dictAction(issue.dict_key)  || '';
  const term    = issue.learn_more?.term;
  const def     = issue.learn_more?.definition || (issue.dict_key ? dictDef(issue.dict_key) : '');
  let block = `**${label}**\n`;
  if (summary) block += `  _${summary}_\n`;
  if (action)  block += `  ⚡ **פעולה ראשונה:** ${action}\n`;
  if (term && def) block += `  📖 **${term}:** ${def}`;
  return block;
}

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
  const overviewRaw = { impressions: 0, clicks: 0, spend: 0, conversions: 0, revenue: 0, sessions: 0, bounceRate: 0, frequency: 0 };
  for (const integ of connected) {
    const data = statsByProvider[integ.provider];
    if (!data?.metrics) continue;
    const t = sumMetrics(Array.isArray(data.metrics) ? data.metrics : []);
    overviewRaw.impressions += t.impressions; overviewRaw.clicks += t.clicks;
    overviewRaw.spend += t.spend; overviewRaw.conversions += t.conversions;
    overviewRaw.revenue += t.revenue; overviewRaw.sessions += t.sessions;
  }
  const engineResult = overviewRaw.clicks > 0 ? analyze(overviewRaw) : null;

  // ── Adaptive greeting: campaign stage awareness ───────────────────────────
  const { adaptive } = context;
  const stagePrefix = adaptive.campaignStage === 'growing'
    ? '📈 הנתונים מראים מגמת צמיחה — '
    : adaptive.campaignStage === 'struggling'
    ? '⚠️ שים לב — הנתונים מצביעים על ירידה — '
    : '';

  let reply = `היי ${profileName}! ${stagePrefix}הנה סקירת הביצועים שלך:\n\n`;
  reply += sections.join('\n\n') + '\n\n';

  if (engineResult) {
    const top    = engineResult.issues[0];
    const action = engineResult.prioritizedActions[0];
    const confidence = Math.round(engineResult.confidence * 100);

    // If this issue is recurring, call it out explicitly
    const isRecurring = adaptive.recurringIssue
      && adaptive.recurringIssue.key === top?.dict_key
      && adaptive.recurringIssue.count >= 3;

    reply += `🔍 **הממצא המרכזי (ביטחון ${confidence}%):**\n`;
    if (isRecurring) {
      reply += `_בעיה זו חוזרת ${adaptive.recurringIssue.count} פעמים בנתונים שלך — שווה לטפל בה._\n`;
    }
    reply += formatIssueBlock(top) + '\n';
    if (action.simple_label && action.simple_label !== action.title) {
      reply += `\n✅ **תוצאה צפויה:** ${action.expectedImpact}`;
    } else {
      reply += `\n⚡ **הצעד הבא:** ${action.first_action || action.title}\n  ✅ ${action.expectedImpact}`;
    }
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

  const dictROAS = dictionary['low_roas'];
  const roasExplain = (globalRoas !== null && globalRoas < 1.5 && dictROAS)
    ? `\n\n💡 **${dictROAS.simple_label}**\n_${dictROAS.simple_summary}_\n\n⚡ **פעולה ראשונה:** ${dictROAS.first_action}\n📖 **ROAS:** ${dictROAS.learn_more.definition}`
    : `\n\n📖 **ROAS:** ${dictROAS?.learn_more?.definition || 'כמה הכנסה נכנסה על כל שקל שהושקע בפרסום.'}`;

  const reply = `📊 **ניתוח תשואת פרסום (ROAS):**\n\n${sections.join('\n')}\n\n**ROAS כולל: ${globalRoas ? globalRoas.toFixed(2) + 'x' : 'N/A'} — ${verdict}**${roasExplain}`;
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

  // Dictionary-driven explanation for low CTR
  const dictCTR = dictionary['low_ctr'];
  const ctrExplain = dictCTR
    ? `\n\n💡 **${dictCTR.simple_label}**\n_${dictCTR.simple_summary}_\n\n⚡ **פעולה ראשונה:** ${dictCTR.first_action}\n📖 **CTR:** ${dictCTR.learn_more.definition}`
    : '';

  const reply = `📊 **ניתוח קליקים (CTR):**\n\n${sections.join('\n')}${ctrExplain}`;
  return { reply, quickActions: ['הצע הזזת תקציב', 'נתח הביצועים הכלליים', 'מה הפעולה הדחופה?'] };
}

function generateIntegrationsResponse(context) {
  return generateTrackingResponse(context);
}

async function generateRecsResponse(context) {
  const { statsByProvider, integrations, recentAnalysis, businessProfile, userId } = context;
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
    return {
      reply: 'אין עדיין נתונים חיים להמלצות. חבר אינטגרציה והרץ ניתוח כדי לקבל המלצות מבוססות נתונים.',
      quickActions: ['חבר אינטגרציה', 'הרץ ניתוח'],
    };
  }

  const result = analyze(globalRaw);
  const actions = result.prioritizedActions.slice(0, 3);
  const confidence = Math.round(result.confidence * 100);

  // ── Adaptive: use business-type-specific impact from dictionary if known ──
  const { adaptive } = context;
  const businessType = adaptive.businessType; // 'ecommerce' | 'services' | 'lead_generation' | null

  // ── Adaptive: acknowledge recurring issue ────────────────────────────────
  const top = result.issues[0];
  const isRecurring = adaptive.recurringIssue
    && adaptive.recurringIssue.key === top?.dict_key
    && adaptive.recurringIssue.count >= 3;

  // ── Try AI-enhanced analysis_summary ─────────────────────────────────────
  // The decision engine identifies WHAT is wrong. AI explains WHY and HOW.
  // Falls back to template output if provider is unavailable.
  const scores = result.scores || {};
  const bottlenecks = result.issues?.map(i => i.dict_key).filter(Boolean) || [];
  const aiResult = await orchestrate(
    CAPABILITIES.ANALYSIS_SUMMARY,
    { metrics: globalRaw, scores, bottlenecks, decisions: actions, businessProfile: businessProfile || {} },
    { userId },
  );

  if (aiResult.ok && aiResult.content?.recommendations?.length > 0) {
    const ai = aiResult.content;
    let reply = `🎯 **המלצות (ביטחון ${confidence}%):**\n\n`;
    if (ai.main_finding) reply += `📌 ${ai.main_finding}\n\n`;
    if (isRecurring) {
      reply += `⚠️ _בעיית ה-${top.simple_label || top.dict_key} חוזרת אצלך ${adaptive.recurringIssue.count} פעמים — הגיע הזמן לטפל בה לעומק._\n\n`;
    }
    ai.recommendations.slice(0, 3).forEach((r, i) => {
      reply += `${i + 1}. **${r.issue}**\n`;
      if (r.root_cause) reply += `   _${r.root_cause}_\n`;
      reply += `   ⚡ ${r.action}\n`;
      if (r.expected_impact) reply += `   ✅ ${r.expected_impact}\n`;
      reply += '\n';
    });
    return { reply, quickActions: ['נתח ביצועים כלליים', 'הצע הזזת תקציב', 'בדוק CTR'] };
  }

  // ── Fallback: template-based recommendations ─────────────────────────────
  let reply = `🎯 **המלצות מותאמות אישית (ביטחון ${confidence}%):**\n\n`;
  if (isRecurring) {
    reply += `⚠️ _בעיית ה-${top.simple_label || top.dict_key} חוזרת אצלך ${adaptive.recurringIssue.count} פעמים — הגיע הזמן לטפל בה לעומק._\n\n`;
  }

  actions.forEach((a, i) => {
    const displayTitle = a.simple_label || a.title;
    reply += `${i + 1}. **${displayTitle}**\n`;

    // If business type is known and the dictionary has a specific impact for it, use it
    const dictEntry  = a.dict_key ? dictionary[a.dict_key] : null;
    const bizImpact  = businessType && dictEntry?.business_impact?.[businessType];
    if (bizImpact) {
      reply += `   _${bizImpact}_\n`;
    } else if (a.simple_summary) {
      reply += `   _${a.simple_summary}_\n`;
    }

    const firstAction = a.first_action || a.why;
    reply += `   ⚡ ${firstAction}\n`;
    reply += `   ✅ ${a.expectedImpact}\n\n`;
  });

  reply += `🔍 **הממצא הדומיננטי:**\n${formatIssueBlock(top)}`;

  return { reply, quickActions: ['נתח ביצועים כלליים', 'הצע הזזת תקציב', 'בדוק CTR'] };
}

// ── Phase 4F: Trends & Learning response ──────────────────────────────────────

/**
 * generateTrendsResponse(context)
 *
 * Uses pre-computed strategy_memory (written by learning-engine after each analyze run).
 * Falls back gracefully when no learning data exists yet.
 */
function generateTrendsResponse(context) {
  const { strategyMemory, profileName, recentAnalysis } = context;

  // ── No learning data yet ───────────────────────────────────────────────────
  if (!strategyMemory || strategyMemory.data_points < 2) {
    const dataNote = recentAnalysis
      ? 'יש לך ניתוח אחד — צריך לפחות 2 כדי לזהות מגמות. הרץ ניתוח נוסף בסבב הבא.'
      : 'עדיין אין ניתוחים. הרץ ניתוח על קמפיין כדי שהמערכת תתחיל ללמוד.';
    return {
      reply:        `📊 **מגמות — ${profileName}:**\n\n${dataNote}`,
      quickActions: ['נתח את הקמפיינים שלי', 'מה מצב הביצועים?', 'הצג המלצות'],
    };
  }

  // ── Trend line ─────────────────────────────────────────────────────────────
  const trendEmoji = {
    improving: '📈',
    declining: '📉',
    stable:    '➡️',
  }[strategyMemory.score_trend] || '➡️';

  const trendLabel = {
    improving: 'מגמת עלייה',
    declining: 'מגמת ירידה',
    stable:    'יציב',
  }[strategyMemory.score_trend] || 'יציב';

  const deltaStr = strategyMemory.score_delta !== null
    ? ` (${strategyMemory.score_delta > 0 ? '+' : ''}${strategyMemory.score_delta} נקודות)`
    : '';

  let reply = `${trendEmoji} **מגמת ביצועים — ${profileName}:**\n\n`;
  reply += `📌 **מגמה:** ${trendLabel}${deltaStr} על פני ${strategyMemory.data_points} ניתוחים\n`;
  reply += `📌 **ציון ממוצע:** ${strategyMemory.dominant_verdict === 'healthy' ? '🟢 בריא' : strategyMemory.dominant_verdict === 'needs_work' ? '🟡 דורש עבודה' : '🔴 קריטי'}\n`;

  // ── Persistent bottlenecks ─────────────────────────────────────────────────
  const pbn = Array.isArray(strategyMemory.persistent_bottlenecks)
    ? strategyMemory.persistent_bottlenecks
    : [];

  if (pbn.length > 0) {
    const bnLabels = {
      ctr:        'CTR — הקריאייטיב לא מושך קליקים',
      conversion: 'המרה — הדף לא סוגר',
      roas:       'ROAS — ההוצאה לא מכוסה',
      traffic:    'תנועה — אין מספיק חשיפות',
    };
    reply += `\n⚠️ **צווארי בקבוק חוזרים (${pbn.length}):**\n`;
    for (const stage of pbn) {
      reply += `  • ${bnLabels[stage] || stage}\n`;
    }
    reply += `_אלה הבעיות שמופיעות שוב ושוב — לא מספיק לפתור פעם אחת._\n`;
  } else {
    reply += `\n✅ **אין צווארי בקבוק חוזרים** — כל בעיה שהופיעה טופלה.\n`;
  }

  // ── Iteration action ───────────────────────────────────────────────────────
  const ia = strategyMemory.iteration_action;
  if (ia?.heAction) {
    const urgencyEmoji = {
      critical: '🚨',
      high:     '🔴',
      medium:   '🟡',
      low:      '🟢',
    }[ia.urgency] || '🔵';

    reply += `\n${urgencyEmoji} **הפעולה הנכונה עכשיו:**\n`;
    reply += `  **${ia.heAction}**\n`;
    reply += `  _${ia.reason}_\n`;
  }

  // ── Period note ────────────────────────────────────────────────────────────
  if (strategyMemory.period_start && strategyMemory.period_end) {
    const from = new Date(strategyMemory.period_start).toLocaleDateString('he-IL');
    const to   = new Date(strategyMemory.period_end).toLocaleDateString('he-IL');
    reply += `\n📅 _תקופת ניתוח: ${from} — ${to}_`;
  }

  return {
    reply,
    quickActions: ['נתח ביצועים כלליים', 'הצג המלצות', 'הצע הזזת תקציב'],
  };
}

// ── Phase 4G: Business Profile response ───────────────────────────────────────

function generateBusinessProfileResponse(context) {
  const { businessProfile, profileName, message, userId } = context;
  const { pct, missingRequired, missingEnrichment } = scoreCompletion(businessProfile);

  // ── Try to extract an answer from the current message ─────────────────────
  // If the user just answered a profile question, save it and acknowledge.
  let extractedConfirmation = null;
  const extracted = message ? extractProfileAnswer(message, missingRequired, missingEnrichment) : null;
  if (extracted) {
    // Async save — fire-and-forget so response returns without waiting
    upsertBusinessProfile(userId, { [extracted.field]: extracted.value }).catch(() => {});
    extractedConfirmation = extracted.confirmationText;

    // Optimistically apply to the local profile copy so the response reflects the update
    const optimisticProfile = { ...(businessProfile || {}), [extracted.field]: extracted.value };
    const updated = scoreCompletion(optimisticProfile);
    Object.assign(context, { businessProfile: optimisticProfile });
    missingRequired.length  = 0;
    missingEnrichment.length = 0;
    missingRequired.push(...updated.missingRequired);
    missingEnrichment.push(...updated.missingEnrichment);
  }

  // ── No profile at all ─────────────────────────────────────────────────────
  if (!context.businessProfile) {
    return {
      reply: `📋 **פרופיל עסקי — ${profileName}:**\n\nעדיין אין פרופיל עסקי. הפרופיל הוא הבסיס לכל הניתוחים — בלעדיו אני לא יודע מה אתה מוכר ולכמה.\n\n❓ **${buildNextProfileQuestion(missingRequired, missingEnrichment) || 'מה אתה מוכר?'}**`,
      quickActions: ['עדכן פרופיל', 'חשב כלכלת יחידה', 'הצג ניתוח ביצועים'],
    };
  }

  const { pct: updatedPct } = scoreCompletion(context.businessProfile);
  const summary = formatProfileSummary(context.businessProfile);
  const completionBar = updatedPct >= 100 ? '🟢 פרופיל מלא' : updatedPct >= 70 ? `🟡 ${updatedPct}% הושלם` : `🔴 ${updatedPct}% הושלם`;

  let reply = '';
  if (extractedConfirmation) reply += `${extractedConfirmation}\n\n`;
  reply += `📋 **פרופיל עסקי — ${completionBar}:**\n\n${summary}\n`;

  if (missingRequired.length > 0) {
    const nextQ = buildNextProfileQuestion(missingRequired, missingEnrichment);
    reply += `\n⚠️ **חסר מידע חשוב** (${missingRequired.length} שדות נדרשים):\n`;
    reply += `❓ **${nextQ}**\n`;
    reply += `_השלמת הפרופיל תשפר את דיוק כל הניתוחים._`;
  } else if (missingEnrichment.length > 0) {
    const nextQ = buildNextProfileQuestion([], missingEnrichment);
    reply += `\n💡 **שדות אופציונליים שיעשירו את הניתוח:**\n`;
    reply += `❓ ${nextQ}`;
  } else {
    reply += `\n✅ _כל המידע הנדרש קיים — הניתוחים מדויקים._`;
  }

  return {
    reply,
    quickActions: ['חשב כלכלת יחידה', 'הצג ניתוח ביצועים', 'פתח בדיקת A/B'],
  };
}

// ── Phase 4G: Economics response ──────────────────────────────────────────────

function generateEconomicsResponse(context) {
  const { businessProfile, globalRaw, profileName, adaptive } = context;

  if (!businessProfile?.price_amount) {
    return {
      reply: `💰 **כלכלת יחידה — ${profileName}:**\n\nלא ניתן לחשב — חסר מחיר בפרופיל העסקי.\n\n❓ **מה המחיר של ההצעה שלך? (מספר בלבד)**`,
      quickActions: ['עדכן פרופיל', 'הצג פרופיל עסקי'],
    };
  }

  // Build live metrics from globalRaw
  const liveMetrics = {
    spend:       globalRaw.spend,
    clicks:      globalRaw.clicks,
    impressions: globalRaw.impressions,
    conversions: globalRaw.conversions,
    revenue:     globalRaw.revenue,
    ctr:         globalRaw.impressions > 0 ? globalRaw.clicks / globalRaw.impressions : 0,
    convRate:    globalRaw.clicks      > 0 ? globalRaw.conversions / globalRaw.clicks : 0,
    cpc:         globalRaw.clicks      > 0 ? globalRaw.spend / globalRaw.clicks : 0,
    roas:        globalRaw.spend       > 0 ? globalRaw.revenue / globalRaw.spend : null,
  };

  const ue = computeUnitEconomics({ businessProfile, liveMetrics });

  // Core numbers
  let reply = `💰 **כלכלת יחידה — ${profileName}:**\n\n`;

  if (ue.cpl !== null) {
    reply += `  • **CPL** (עלות ליד): ₪${ue.cpl} ${cplStatusLabel(ue.cplStatus)}\n`;
    reply += `  • **break-even CPL**: ₪${ue.breakEvenCPL} | **מקסימום בר-קיימא**: ₪${ue.sustainableCPL}\n`;
  }
  if (ue.cac !== null) reply += `  • **CAC** (עלות גיוס לקוח): ₪${ue.cac}\n`;
  if (ue.ltv !== null) reply += `  • **LTV** (ערך חיי לקוח): ₪${ue.ltv}${businessProfile.pricing_model === 'recurring' ? ' (3 חודשים)' : ''}\n`;
  if (ue.roas !== null) reply += `  • **ROAS**: ${ue.roas}x ${roasLabel(ue.roas)}\n`;
  if (ue.paybackMonths !== null) reply += `  • **החזר השקעה**: ${ue.paybackMonths} חודשים\n`;

  // Verdict
  if (ue.cplStatus === 'profitable') {
    reply += `\n✅ **המספרים בריאים** — אתה מרוויח על כל ליד. שקול להגדיל תקציב.`;
  } else if (ue.cplStatus === 'marginal') {
    reply += `\n⚠️ **גבולי** — אתה סביב נקודת האיזון. שפר המרות או הורד עלות ליד.`;
  } else if (ue.cplStatus === 'losing') {
    reply += `\n🔴 **מפסיד** — עלות הליד גבוהה מה-LTV. עצור והתאם לפני שמגדילים תקציב.`;
  } else if (globalRaw.spend === 0) {
    // Pre-launch state — show simulation hint
    reply += `\n💡 _אין עדיין נתוני קמפיין. אחרי ההשקה תראה כאן CPL ו-ROAS בפועל._`;
  }

  // Funnel backward calculation if monthly budget set
  if (businessProfile.monthly_budget && businessProfile.price_amount) {
    const targetRevenue = businessProfile.monthly_budget * 3; // rough 3x ROAS target
    const funnel = computeFunnelEconomics({ targetRevenue, businessProfile, liveMetrics });
    if (funnel.salesNeeded) {
      reply += `\n\n📊 **פונל לעמידה ביעד (ROAS 3x):**`;
      reply += `\n  • מכירות נדרשות: ${funnel.salesNeeded}`;
      if (funnel.leadsNeeded)       reply += ` | לידים: ${funnel.leadsNeeded}`;
      if (funnel.clicksNeeded)      reply += ` | קליקים: ${funnel.clicksNeeded}`;
      if (funnel.budgetNeeded)      reply += `\n  • תקציב נדרש: ₪${funnel.budgetNeeded}`;
      if (funnel.feasible === false) reply += ` ⚠️ (פער של ₪${funnel.gap} מהתקציב הנוכחי)`;
      if (funnel.feasible === true)  reply += ` ✅ (בתוך התקציב)`;
    }
  }

  return {
    reply,
    quickActions: ['הצג ביצועי קמפיין', 'עדכן פרופיל עסקי', 'פתח בדיקת A/B'],
  };
}

// ── Phase 4G: A/B Test response ───────────────────────────────────────────────

function generateTestResponse(context) {
  const { runningTests, strategyMemory, profileName } = context;

  // ── No tests running ──────────────────────────────────────────────────────
  if (!runningTests || runningTests.length === 0) {
    // Suggest what to test next based on bottleneck
    const bottleneckStage = strategyMemory?.persistent_bottlenecks?.[0] || null;
    const suggestion      = buildNextTestSuggestion([], bottleneckStage);

    let reply = `🔬 **בדיקות A/B — ${profileName}:**\n\nאין בדיקות פעילות כרגע.\n\n`;
    reply += `**כלל הברזל:** בודקים משתנה אחד בלבד. לא מחליפים הכול ביחד.\n`;

    if (suggestion) {
      reply += `\n💡 **מה לבדוק עכשיו — ${suggestion.label}:**\n`;
      reply += `  ${suggestion.guidance}\n`;
    } else {
      reply += `\n💡 _הרץ ניתוח ביצועים כדי שאדע על איזה צוואר בקבוק להמליץ לבדוק._`;
    }

    return {
      reply,
      quickActions: ['נתח ביצועים כלליים', 'הצג מגמות', 'עדכן פרופיל עסקי'],
    };
  }

  // ── Show running tests ────────────────────────────────────────────────────
  const today = new Date();
  const dueTests = runningTests.filter(t => {
    const end = new Date(t.start_date);
    end.setDate(end.getDate() + (t.planned_days || 7));
    return today >= end;
  });

  let reply = `🔬 **בדיקות A/B פעילות — ${profileName}:**\n\n`;

  for (const test of runningTests) {
    reply += formatTestCard(test) + '\n\n';
  }

  if (dueTests.length > 0) {
    reply += `⏰ **${dueTests.length} בדיקה/ות הגיעו לתאריך הסיום** — זמן להכריע winner ולסגור.\n`;
  }

  // Suggest next variable to test (avoid already-running ones)
  const bottleneckStage = strategyMemory?.persistent_bottlenecks?.[0] || null;
  const next = buildNextTestSuggestion(runningTests, bottleneckStage);
  if (next) {
    reply += `\n➡️ **הבדיקה הבאה בתור — ${next.label}:**\n  ${next.guidance}`;
  }

  return {
    reply,
    quickActions: ['הצג מגמות', 'נתח ביצועים כלליים', 'חשב כלכלת יחידה'],
  };
}

// ── Phase 4H: Ad Copy Generation response ─────────────────────────────────────

async function generateCopyResponse(context) {
  const { businessProfile, strategyMemory, profileName, userId } = context;

  if (!businessProfile?.offer) {
    return {
      reply: `✍️ **כתיבת קופי — ${profileName}:**\n\nלא ניתן לכתוב מודעות ללא פרופיל עסקי.\n\n❓ **מה אתה מוכר? (משפט אחד, ספציפי)**\n\n_עדכן את הפרופיל כדי שאוכל לכתוב קופי מותאם לעסק שלך._`,
      quickActions: ['עדכן פרופיל עסקי', 'הצג פרופיל נוכחי'],
    };
  }

  // Determine bottleneck to prioritise the right framework
  const bottleneck = strategyMemory?.persistent_bottlenecks?.[0] || null;
  const platform   = 'meta';

  // Build bottleneck note (shared by AI and fallback paths)
  let bottleneckNote = '';
  if (bottleneck) {
    const bnLabel = {
      ctr:          'CTR נמוך — הוריאציות מתחילות בהוק חזק',
      conversion:   'המרה נמוכה — הוריאציות מדגישות תוצאה ו-CTA',
      roas:         'ROAS נמוך — הוריאציות מדגישות ערך ייחודי',
      creative:     'קריאייטיב — הוריאציות מתחילות בפתיחת כאב',
      landing_page: 'דף נחיתה — הוריאציות מדגישות בהירות הצעה',
    }[bottleneck] || '';
    if (bnLabel) bottleneckNote = `\n_🎯 מותאם לצוואר הבקבוק: ${bnLabel}_\n`;
  }

  // ── Try AI-generated copy via orchestrator ─────────────────────────────────
  const aiResult = await orchestrate(
    CAPABILITIES.AD_COPY,
    { businessProfile, bottleneck, platform },
    { userId },
  );

  if (aiResult.ok && Array.isArray(aiResult.content?.variants) && aiResult.content.variants.length > 0) {
    const aiVariants = aiResult.content.variants;
    let reply = `✍️ **3 וריאציות קופי — ${businessProfile.business_name || profileName}:**${bottleneckNote}\n\n`;
    reply += `_בדוק משתנה אחד בלבד — בחר וריאציה אחת ל-A/B test._\n\n`;
    reply += aiVariants.map(v => formatCopyCard(v)).join('\n\n---\n\n');
    reply += `\n\n📌 **הצעד הבא:** בחר וריאציה אחת, הרץ אותה 7 ימים מול ה-control הנוכחי.`;
    return { reply, quickActions: ['פתח בדיקת A/B', 'נתח ביצועים כלליים', 'חשב כלכלת יחידה'] };
  }

  // ── Fallback: template-based copy ─────────────────────────────────────────
  const variants = generateAdCopy({ businessProfile, bottleneck, platform });
  let reply = `✍️ **3 וריאציות קופי — ${businessProfile.business_name || profileName}:**${bottleneckNote}\n\n`;
  reply += `_בדוק משתנה אחד בלבד — בחר וריאציה אחת ל-A/B test._\n\n`;
  reply += variants.map(v => formatCopyCard(v)).join('\n\n---\n\n');
  reply += `\n\n📌 **הצעד הבא:** בחר וריאציה אחת, הרץ אותה 7 ימים מול ה-control הנוכחי.`;

  return {
    reply,
    quickActions: ['פתח בדיקת A/B', 'נתח ביצועים כלליים', 'חשב כלכלת יחידה'],
  };
}

// ── Creative brief generator (Claude) ────────────────────────────────────────
async function generateCreativeResponse(context) {
  const { businessProfile, recentAnalysis, strategyMemory, memoryRaw, runningTests, profileName, userId } = context;

  if (!businessProfile || !scoreCompletion(businessProfile)) {
    return {
      reply: `🎨 כדי לייצר קריאייטיב ויזואלי אני צריך קודם להכיר את העסק שלך.\n\n` +
             `ספר לי: **מה אתה מוכר, למי, ומה התוצאה שהלקוח מקבל?**`,
      quickActions: ['ספר על העסק שלך', 'כתוב קופי למודעה', 'נתח ביצועים'],
    };
  }

  // ── Step 1: build marketing memory from all available context sources ───────
  // recentAnalysis.metrics contains merged computed metrics (ctr, roas, cpc, etc.)
  // memoryRaw is the raw loadUserMemory() nested map — correct shape for buildMarketingMemory
  const { buildMarketingMemory } = require('./_shared/marketing-memory');
  const memory = buildMarketingMemory({
    businessProfile:  businessProfile,
    apiCache:         recentAnalysis?.metrics       || null,
    analysisResults:  recentAnalysis                || null,
    strategyMemory:   strategyMemory                || null,
    userIntelligence: memoryRaw                     || null,
    abTests:          runningTests                  || [],
  });

  // ── Step 2: build asset-type-specific context pack ───────────────────────────
  // ad_visual: cold traffic feed — pain > differentiator > message priority
  const { buildCreativeContext } = require('./_shared/creative-context-pack');
  const contextPack = buildCreativeContext(memory, 'ad_visual');

  // ── Step 3: build template copy variants to anchor the creative brief ────────
  const bottleneck = strategyMemory?.persistent_bottlenecks?.[0] || null;
  const { generateAdCopy } = require('./_shared/ad-copy-generator');
  const adCopyVariants = generateAdCopy({ businessProfile, bottleneck, platform: 'meta' });

  // ── Step 4: orchestrate — passes memory + contextPack into upgraded prompt ───
  const aiResult = await orchestrate(
    CAPABILITIES.AD_CREATIVE,
    { memory, contextPack, adCopyVariants, platform: 'meta' },
    { userId },
  );

  if (aiResult.ok && Array.isArray(aiResult.content?.creatives) && aiResult.content.creatives.length > 0) {
    const creatives  = aiResult.content.creatives;
    const decision   = aiResult.content.decision || null;

    let reply = `🎨 **${creatives.length} קונספטים קריאייטיב — ${businessProfile.business_name || profileName}:**\n\n`;

    // Surface the strategic decision so the user sees the creative reasoning
    if (decision?.primary_emotional_trigger) {
      reply += `_עוגן רגשי: **${decision.primary_emotional_trigger}**_\n\n`;
    }

    creatives.forEach((c, i) => {
      const label = c.variant_name || String.fromCharCode(65 + i);
      reply += `**${i + 1}. ${label}** — _${c.emotional_angle || ''}_\n`;
      if (c.visual_strategy)   reply += `🎯 **אסטרטגיה:** ${c.visual_strategy}\n`;
      if (c.core_scene)        reply += `🖼️ **סצנה:** ${c.core_scene}\n`;
      if (c.tension_or_contrast) reply += `⚡ **מתח ויזואלי:** ${c.tension_or_contrast}\n`;
      if (c.text_overlay)      reply += `📝 **טקסט על תמונה:** ${c.text_overlay}\n`;
      if (c.color_palette)     reply += `🎨 **צבעים:** ${Array.isArray(c.color_palette) ? c.color_palette.join(' · ') : c.color_palette}\n`;
      if (c.external_image_prompt) reply += `🤖 **Image prompt:**\n> ${c.external_image_prompt}\n`;
      if (c.designer_notes)    reply += `💡 _${c.designer_notes}_\n`;
      reply += '\n---\n\n';
    });

    reply += `📌 **הצעד הבא:** שלח את ה-image prompt לכלי יצירת תמונות (DALL-E, Midjourney, Firefly).`;
    return {
      reply,
      quickActions: ['צור קופי מודעה', 'צור דף נחיתה', 'נתח ביצועים'],
    };
  }

  // Fallback
  return {
    reply: `🎨 **קריאייטיב ויזואלי — ${businessProfile.business_name || profileName}:**\n\n` +
           `לא הצלחתי ליצור בריף ויזואלי כרגע. ודא שמפתח Anthropic מוגדר ונסה שנית.\n\n` +
           `בינתיים, צור קופי טקסט ושתף אותו עם הדיזיינר שלך.`,
    quickActions: ['כתוב קופי למודעה', 'צור דף נחיתה'],
  };
}

// ── Landing page / visual asset generator (HTML pipeline) ────────────────────
async function generateLandingPageResponse(context) {
  const { businessProfile, profileName, userId, memoryRaw, recentAnalysis, strategyMemory, runningTests, message } = context;

  if (!businessProfile || !scoreCompletion(businessProfile)) {
    return {
      reply: `📄 כדי לבנות דף נחיתה אני צריך קודם להכיר את העסק שלך.\n\n` +
             `ספר לי: **מה אתה מוכר, מה המחיר, ומה התוצאה שהלקוח מקבל?**`,
      quickActions: ['ספר על העסק שלך', 'נתח ביצועים'],
    };
  }

  // Detect asset type from the user's message
  let assetType = 'landing_page_html';
  if (/\b(בנר|banner|באנר)\b/i.test(message))                                 assetType = 'banner_html';
  else if (/\b(ad.?card|מודעה ריבועית|כרטיס מודעה)\b/i.test(message))         assetType = 'ad_html';
  else if (/\b(hero|כותרת ראשית|hero.?section|landing.?hero)\b/i.test(message)) assetType = 'landing_hero';

  try {
    // Step 1: Build marketing memory from all available context sources
    const { buildMarketingMemory } = require('./_shared/marketing-memory');
    const memory = buildMarketingMemory({
      businessProfile,
      apiCache:         recentAnalysis?.metrics ?? null,
      analysisResults:  recentAnalysis          ?? null,
      strategyMemory:   strategyMemory          ?? null,
      userIntelligence: memoryRaw               ?? null,
      abTests:          runningTests            ?? [],
    });

    // Step 2: Build landing structure (section list + CTA strategy + hierarchy)
    const { buildLandingStructure } = require('./_shared/landing-structure-engine');
    const goal        = memory.current?.primary_goal  || 'leads';
    const funnelStage = memory.current?.funnel_stage  || 'consideration';
    const structure   = buildLandingStructure(memory, assetType, goal, funnelStage);

    // Step 3: Build HTML blueprint (resolved props + layout per section, no HTML yet)
    const { buildHTMLBlueprint } = require('./_shared/html-blueprint-builder');
    const blueprint = buildHTMLBlueprint(structure, null, memory);

    // Step 4: Compose full HTML + CSS (self-contained, RTL, mobile-first)
    const { composeHTML } = require('./_shared/html-composer');
    const composeResult = composeHTML(blueprint);

    // Step 5: Validate — block critical failures, surface warnings
    const { validateGeneric } = require('./_shared/validators/anti-generic-validator');
    const { validateHTML }    = require('./_shared/validators/html-validator');

    const genericResult = validateGeneric({ blueprint, composeResult, memory });
    const htmlResult    = validateHTML(composeResult.html, { assetType });

    // Block if either validator finds critical issues
    if (!genericResult.valid || !htmlResult.valid) {
      const criticalIssues = [
        ...genericResult.issues.filter(i => i.severity === 'critical' || i.severity === 'major'),
        ...htmlResult.issues.filter(i => i.severity === 'critical' || i.severity === 'major'),
      ].slice(0, 3);
      const issueLines = criticalIssues.map(i => `• ${i.message}`).join('\n');
      return {
        reply: `📄 הדף לא נשמר — נמצאו בעיות איכות שחוסמות פרסום:\n\n${issueLines}\n\n` +
               `_הוסף מידע עסקי מפורט יותר ונסה שנית._`,
        quickActions: ['ספר על העסק שלך', 'נתח ביצועים'],
      };
    }

    // Collect non-blocking warnings to surface in reply
    const allWarnings = [
      ...genericResult.issues.filter(i => i.severity === 'minor' || i.severity === 'warning'),
      ...htmlResult.issues.filter(i => i.severity === 'minor' || i.severity === 'warning'),
    ];

    // Step 6: Save to Supabase Storage + DB, get preview URL
    const { saveAsset } = require('./_shared/asset-storage');
    const saved = await saveAsset({
      userId,
      html:          composeResult.html,
      composeResult,
      title: businessProfile.business_name
        ? `${businessProfile.business_name} — ${_assetLabel(assetType)}`
        : null,
    });

    // Step 7: Build reply with preview link (no raw HTML returned to user)
    const sectionCount = Array.isArray(structure.sections) ? structure.sections.length : 0;
    const imageSlots   = saved.metadata?.image_slots ?? 0;
    const expiry       = new Date(saved.expiresAt).toLocaleDateString('he-IL');

    let reply = `📄 **${_assetLabel(assetType)} מוכן — ${businessProfile.business_name || profileName}**\n\n`;
    reply += `🔗 **קישור לתצוגה מקדימה:**\n\`${saved.previewUrl}\`\n\n`;
    reply += `📐 **מבנה:** ${sectionCount} סקשנים`;
    if (imageSlots > 0) reply += ` · ${imageSlots} מקומות תמונה`;
    reply += `\n⏳ **תוקף:** ${expiry}\n\n`;
    reply += `_הדף כולל placeholder לתמונות — הוסף תמונות אמיתיות לפני פרסום._`;

    if (allWarnings.length > 0) {
      reply += `\n\n⚠️ _${allWarnings.slice(0, 2).map(w => w.message).join(' · ')}_`;
    } else if (composeResult.warnings?.length > 0) {
      reply += `\n\n⚠️ _${composeResult.warnings.slice(0, 2).join(' · ')}_`;
    }

    return {
      reply,
      quickActions: ['הורד ZIP', 'צור קריאייטיב ויזואלי', 'כתוב קופי מודעה', 'נתח ביצועים'],
      assetId:    saved.assetId,
      previewUrl: saved.previewUrl,
      expiresAt:  saved.expiresAt,
    };

  } catch (err) {
    console.error('[campaigner-chat] generateLandingPageResponse error:', err.message);
    return {
      reply: `📄 אירעה שגיאה בבניית הדף. נסה שוב עוד רגע.\n\n_פרטי שגיאה: ${err.code || err.message || 'UNKNOWN'}_`,
      quickActions: ['נסה שוב', 'ספר על העסק שלך'],
    };
  }
}

function _assetLabel(assetType) {
  return { landing_page_html: 'דף נחיתה', banner_html: 'באנר', ad_html: 'כרטיס מודעה', landing_hero: 'Hero Section' }[assetType] || 'דף נחיתה';
}

// ── Helper ────────────────────────────────────────────────────────────────────
function providerLabel(provider) {
  return { google_ads: 'Google Ads', ga4: 'Google Analytics 4', meta: 'Meta Ads' }[provider] || provider;
}

// ── Router ────────────────────────────────────────────────────────────────────
async function generateResponse(intent, context) {
  switch (intent) {
    case 'overview':      return generateOverviewResponse(context);
    case 'budget':        return generateBudgetResponse(context);
    case 'top_ads':       return generateTopAdsResponse(context);
    case 'tracking':      return generateTrackingResponse(context);
    case 'roas':          return generateROASResponse(context);
    case 'ctr':           return generateCTRResponse(context);
    case 'recs':          return await generateRecsResponse(context);
    case 'integrations':  return generateIntegrationsResponse(context);
    case 'trends':        return generateTrendsResponse(context);
    case 'business':      return generateBusinessProfileResponse(context);
    case 'economics':     return generateEconomicsResponse(context);
    case 'test':          return generateTestResponse(context);
    case 'copy':          return await generateCopyResponse(context);
    case 'creative':      return await generateCreativeResponse(context);
    case 'landing':       return await generateLandingPageResponse(context);
    case 'visual':        return await generateLandingPageResponse(context);
    default:              return generateOverviewResponse(context);
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options();
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
    sanitiseText(message); // reject XSS patterns before reaching business logic

    // Build context from DB
    const chatContext = await buildContext(user.id);
    chatContext.message = message;   // thread raw message so generators can read it

    // Detect intent
    const intent = detectIntent(message);

    // ── Engine result (shared between beginner layer + intelligence update) ──
    const engineResult = chatContext.globalRaw.clicks > 0
      ? analyze(chatContext.globalRaw)
      : null;

    // ── Beginner execution layer ─────────────────────────────────────────────
    // Runs before generateResponse — may override, wrap, or pass through.
    const beginnerState = detectBeginnerState(
      chatContext.adaptive,
      chatContext.integrations,
      chatContext.recentAnalysis,
    );

    let responseData;
    if (beginnerState.active) {
      const override = generateBeginnerOverride(beginnerState, intent, message, chatContext);
      if (override) {
        // Redirect or friction/overthink intercept — replace normal response
        responseData = override;
      } else {
        // Normal flow runs, but we append milestone progress bar + next-step guidance
        const normal = await generateResponse(intent, chatContext);
        responseData = appendBeginnerAddendum(beginnerState, normal, engineResult);
      }
    } else {
      responseData = await generateResponse(intent, chatContext);
    }

    const { reply, quickActions } = responseData;

    await writeRequestLog(buildLogPayload(context, 'info', 'campaigner_chat_response', {
      user_id:             user.id,
      intent,
      beginner_milestone:  beginnerState.active ? beginnerState.milestone : 'graduated',
      providers_connected: chatContext.integrations.filter(i => i.connection_status === 'active').length,
    }));

    // ── Fire-and-forget: user intelligence update ────────────────────────────
    updateIntelligenceFromInteraction(user.id, {
      intent,
      message,
      engineResult,
      globalRaw: chatContext.globalRaw,
    }).catch(() => {});

    // ── Fire-and-forget: beginner milestone progress ─────────────────────────
    if (beginnerState.active) {
      const nextProgress = resolveProgressUpdate(beginnerState, intent, message, chatContext, engineResult);
      if (nextProgress) {
        persistMilestoneProgress(user.id, nextProgress).catch(() => {});
      }
    }

    return ok({ reply, quickActions, intent }, context.requestId);

  } catch (error) {
    await writeRequestLog(buildLogPayload(context, 'error', error.message || 'campaigner_chat_failed', {
      code: error.code || 'INTERNAL_ERROR',
    })).catch(() => {});
    return fail(error, context.requestId);
  }
};
