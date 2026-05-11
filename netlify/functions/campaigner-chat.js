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
require('./_shared/env');

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
const { generateAdVisual, detectPlatform, detectAdType } = require('./_shared/visual-generator');
const { route: routeModel }             = require('./_shared/model-router');
const OpenRouterAdapter                 = require('./_shared/providers/adapters/openrouter');
const iLogger                           = require('./_shared/intelligence-logger');

// ── AI cost logger (fire-and-forget) ─────────────────────────────────────────
async function _logAICost({ userId, taskType, raw, routing }) {
  try {
    const sb = getAdminClient();
    await sb.from('ai_cost_log').insert({
      user_id:       userId || null,
      task_type:     taskType,
      model_used:    raw?._model || routing?.model || 'unknown',
      provider:      raw?._via === 'direct_fallback' ? 'anthropic_direct' : 'openrouter',
      input_tokens:  raw?._usage?.promptTokens     || 0,
      output_tokens: raw?._usage?.completionTokens || 0,
      cost_usd:      raw?._cost || 0,
      latency_ms:    raw?._latency || 0,
      success:       true,
    });
  } catch { /* non-critical */ }
}

// ── Intent detection ──────────────────────────────────────────────────────────
// NOTE: JavaScript \b doesn't match Hebrew word boundaries (only ASCII \w).
// Using plain substring match (no \b) — false positives are negligible for
// the multi-character Hebrew terms listed here.
// Most-specific intents first to avoid false-positive substring matches
const INTENT_PATTERNS = [
  // ── Content creation (checked first — very explicit keywords) ───────────────
  { intent: 'creative',      patterns: /(קריאייטיב|עיצוב ויזואלי|גרפיקה|ויזואל|עיצוב מודעה|תמונת מודעה|צור מודעה|עשה לי מודעה|מודעה לפייסבוק|מודעה לאינסטגרם|פוסט ממומן|פרסומת|ביזואל|visual.?ad|ad.*design|creative.?concept|banner|create.*ad|generate.*visual)/i },
  { intent: 'landing_page',  patterns: /(דף נחיתה|תכנן דף|מבנה דף|מבנה נחיתה|עיצוב דף|דף הנחיתה שלי|landing.?page|above.?the.?fold)/i },
  { intent: 'copy',          patterns: /(כתוב לי|כתוב עבורי|קופי|מודעת טקסט|כותרת מודעה|ad text|creative text|\bcopy\b|headline|כתוב טקסט)/i },
  // ── Specific metrics ────────────────────────────────────────────────────────
  { intent: 'economics',     patterns: /(כלכלה|עלות ליד|עולה ליד|כמה ליד|רווחיות|כמה להמיר|\bCAC\b|\bLTV\b|\bCPL\b|break.?even|payback|economics|feasib)/i },
  { intent: 'roas',          patterns: /(החזר על פרסום|תשואה על פרסום|\broas\b|\breturn on ad)/i },
  { intent: 'ctr',           patterns: /(אחוז קליקים|קצב קליקים|\bctr\b|\bclick.through)/i },
  { intent: 'test',          patterns: /(וריאציה|ניסוי|מה לבדוק|a\/b|ab test|hypothesis|variant|split test)/i },
  // ── Analytics & data ────────────────────────────────────────────────────────
  { intent: 'budget',        patterns: /(תקציב|הזזת תקציב|חלוקת תקציב|הקצאת תקציב|\bbudget\b|reallocat)/i },
  { intent: 'top_ads',       patterns: /(מודעות הכי|הכי טובות|top ads|\bbest ads\b|מודעות מובילות|ניצחון קמפיין)/i },
  { intent: 'tracking',      patterns: /(טראקינג|מעקב המרות|פיקסל|pixel|tracking|audit)/i },
  { intent: 'recs',          patterns: /(המלצ|מה לעש|תן לי עצה|recommend|suggest|what should)/i },
  { intent: 'trends',        patterns: /(טרנד|מגמה|ירידה בביצועים|היסטוריה|לאורך זמן|שינוי בביצועים|trend|progress over)/i },
  { intent: 'overview',      patterns: /(ביצועי|ביצועים|סקירה כללית|סטטוס קמפיין|overview|how am i doing)/i },
  { intent: 'integrations',  patterns: /(חיבור מערכת|חיבור גוגל|חיבור מטא|integration|ga4|connected)/i },
  // ── Business profile (broad terms last to avoid false matches) ──────────────
  { intent: 'business',      patterns: /(פרופיל עסקי|מה אני מוכר|מחיר שלי|קהל יעד שלי|הצעת הערך|business profile)/i },
];

function detectIntent(message) {
  const lower = message.toLowerCase();
  for (const { intent, patterns } of INTENT_PATTERNS) {
    if (patterns.test(lower)) return intent;
  }
  return 'general';
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
    return {
      reply,
      quickActions: ['פתח בדיקת A/B', 'נתח ביצועים כלליים', 'חשב כלכלת יחידה'],
      copyVariants: aiVariants.map((v, i) => ({
        label:    `וריאציה ${v.variant || String.fromCharCode(65 + i)}`,
        headline: v.headline || '',
        body:     v.body     || '',
        cta:      v.cta      || '',
      })),
    };
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
    copyVariants: variants.map((v, i) => ({
      label:    `וריאציה ${v.variant || String.fromCharCode(65 + i)}`,
      headline: v.headline || '',
      body:     v.body     || '',
      cta:      v.cta      || '',
    })),
  };
}

// ── Visual ad generator — returns pendingVisual so frontend fires the long DALL-E
// request in a separate call (avoids hitting Netlify's 26s function timeout).
async function generateCreativeResponse(context) {
  const { businessProfile, profileName, message } = context;

  if (!businessProfile?.offer) {
    return {
      reply: `🎨 כדי לייצר מודעה ויזואלית אני צריך קודם להכיר את העסק שלך.\n\n` +
             `ספר לי: **מה אתה מוכר, למי, ומה התוצאה שהלקוח מקבל?**`,
      quickActions: ['ספר על העסק שלך', 'כתוב קופי למודעה', 'נתח ביצועים'],
    };
  }

  // ── Detect platform from user's message ──────────────────────────────────
  const platform = detectPlatform(message);

  if (!platform) {
    const platformSizes = {
      facebook:  '1792×1024 (Landscape)',
      instagram: '1080×1080 (Square)',
      tiktok:    '1080×1920 (Vertical)',
      google:    '1792×1024 (Display)',
    };
    const lines = Object.entries(platformSizes)
      .map(([p, s]) => `• **${p.charAt(0).toUpperCase() + p.slice(1)}** — ${s}`)
      .join('\n');

    return {
      reply: `🎯 **לאיזו פלטפורמה המודעה?**\n\nכל פלטפורמה דורשת גודל שונה:\n\n${lines}\n\n_ניתן לשנות אחרי הגנרציה אם תרצה גרסה נוספת._`,
      quickActions: ['מודעה לפייסבוק', 'מודעה לאינסטגרם', 'מודעה לטיקטוק', 'מודעה לגוגל'],
    };
  }

  // ── Return pendingVisual — frontend will call /generate-ad-visual separately ─
  // This keeps campaigner-chat well under Netlify's 26s timeout.
  const PLATFORM_LABEL = { facebook: 'פייסבוק', instagram: 'אינסטגרם', tiktok: 'טיקטוק', google: 'גוגל' };
  const pLabel = PLATFORM_LABEL[platform] || platform;

  return {
    reply: `🎨 **מייצר מודעה ל${pLabel}...**\n\n_ה-AI עובד על התמונה — זה עשוי לקחת עד 20 שניות_`,
    quickActions: [],
    pendingVisual: {
      platform,
      type:     detectAdType(message),
      offer:    businessProfile.offer,
      audience: businessProfile.target_audience || '',
      deal:     businessProfile.unique_offer    || '',
      brand:    businessProfile.business_name   || '',
    },
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

  // Detect iteration request — user wants multiple variants instead of a single asset
  const isVariationRequest = /\b(וריאציות|variations|variants|גרסאות שונות|כמה גרסאות|3 גרסאות|שלוש גרסאות|כמה וריאציות|3 וריאציות)\b/i.test(message);

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

    // Step 2b: Variation mode — generate 3 distinct variants instead of a single asset
    if (isVariationRequest) {
      const { selectVariationModes } = require('./_shared/iteration-engine');
      return await _generateVariants(selectVariationModes(3), memory, structure, assetType, context);
    }

    // Step 3: Build HTML blueprint (resolved props + layout per section, no HTML yet)
    const { buildHTMLBlueprint } = require('./_shared/html-blueprint-builder');
    const blueprint = buildHTMLBlueprint(structure, null, memory);

    // Inject pixel_id from user's Meta config (null-safe — works even if not connected)
    if (blueprint.meta) blueprint.meta.pixel_id = await _getPixelId(userId);

    // Step 4: Compose full HTML + CSS (self-contained, RTL, mobile-first)
    // asset_id is not yet known — placeholder will be injected in Step 6 after saveAsset()
    const { composeHTML } = require('./_shared/html-composer');
    const composeResult = composeHTML(blueprint);

    // Step 5: Validate — block critical failures, surface warnings
    const { validateGeneric } = require('./_shared/validators/anti-generic-validator');
    const { validateHTML }    = require('./_shared/validators/html-validator');
    const { validateVisual }  = require('./_shared/validators/visual-validator');

    const genericResult = validateGeneric({ blueprint, composeResult, memory });
    const htmlResult    = validateHTML(composeResult.html, { assetType });
    const visualResult  = validateVisual({ blueprint, html: composeResult.html, assetType });

    // Block if content or structural validators find critical/major issues
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

    // Collect non-blocking warnings (content + HTML + visual)
    const allWarnings = [
      ...genericResult.issues.filter(i => i.severity === 'minor' || i.severity === 'warning'),
      ...htmlResult.issues.filter(i => i.severity === 'minor' || i.severity === 'warning'),
      ...visualResult.issues.filter(i => i.severity === 'major' || i.severity === 'minor'),
    ];

    // Step 6: Save to Supabase Storage + DB, get preview URL
    // We need the assetId before saving so forms contain the real value.
    // Strategy: pre-generate the UUID, inject it into HTML, then save with that same ID.
    const crypto = require('crypto');
    const pregenId = crypto.randomUUID();
    const htmlWithAssetId = composeResult.html.replace(/\{\{asset_id\}\}/g, pregenId);

    const { saveAsset } = require('./_shared/asset-storage');
    const saved = await saveAsset({
      userId,
      html:          htmlWithAssetId,
      composeResult: { ...composeResult, html: htmlWithAssetId },
      title: businessProfile.business_name
        ? `${businessProfile.business_name} — ${_assetLabel(assetType)}`
        : null,
      _pregenId: pregenId,   // passed through so saveAsset uses this UUID instead of generating a new one
    });

    // Fire-and-forget: store last generated asset reference for feedback lookups
    const { storeLastGeneratedAsset } = require('./_shared/feedback-loop');
    storeLastGeneratedAsset(userId, {
      asset_id:    saved.assetId,
      template_id: blueprint.template_id || null,
      asset_type:  assetType,
    }).catch(() => {});

    // Fire-and-forget: advance onboarding progress so progressive unlock triggers
    const { advanceOnboarding } = require('./_shared/product-context');
    const _sb = getAdminClient();
    advanceOnboarding(userId, _sb, 'profile_started').catch(() => {});
    advanceOnboarding(userId, _sb, 'first_asset').catch(() => {});
    // Count assets to check if multiple_assets threshold reached
    _sb.from('generated_assets').select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .then(({ count }) => { if ((count || 0) >= 3) advanceOnboarding(userId, _sb, 'multiple_assets').catch(() => {}); })
      .catch(() => {});

    // Step 7: Build reply with preview link (no raw HTML returned to user)
    const sectionCount = Array.isArray(structure.sections) ? structure.sections.length : 0;
    const imageSlots   = saved.metadata?.image_slots ?? 0;
    const expiry       = new Date(saved.expiresAt).toLocaleDateString('he-IL');

    const visualGradeEmoji = { A: '🟢', B: '🟡', C: '🟠', D: '🔴', F: '🔴' }[visualResult.grade] || '⚪';

    let reply = `📄 **${_assetLabel(assetType)} מוכן — ${businessProfile.business_name || profileName}**\n\n`;
    reply += `🔗 **קישור לתצוגה מקדימה:**\n\`${saved.previewUrl}\`\n\n`;
    reply += `📐 **מבנה:** ${sectionCount} סקשנים`;
    if (imageSlots > 0) reply += ` · ${imageSlots} מקומות תמונה`;
    reply += `\n${visualGradeEmoji} **ציון ויזואלי:** ${visualResult.combined_score}/100 (דרגה ${visualResult.grade})`;
    reply += ` · בהירות: ${visualResult.clarity_score} · היררכיה: ${visualResult.hierarchy_score}`;
    reply += `\n⏳ **תוקף:** ${expiry}\n\n`;
    reply += `_הדף כולל placeholder לתמונות — הוסף תמונות אמיתיות לפני פרסום._`;

    if (allWarnings.length > 0) {
      reply += `\n\n⚠️ _${allWarnings.slice(0, 2).map(w => w.message).join(' · ')}_`;
    } else if (composeResult.warnings?.length > 0) {
      reply += `\n\n⚠️ _${composeResult.warnings.slice(0, 2).join(' · ')}_`;
    }

    return {
      reply,
      quickActions: ['כתוב קופי למודעה', 'נתח ביצועים', 'חשב כלכלת יחידה', 'הצג המלצות'],
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

// ── Pixel ID lookup — returns user's Meta pixel_id or null ───────────────────
async function _getPixelId(userId) {
  try {
    const sb = getAdminClient();
    const { data } = await sb
      .from('user_meta_config')
      .select('pixel_id')
      .eq('user_id', userId)
      .eq('setup_completed', true)
      .maybeSingle();
    return data?.pixel_id || null;
  } catch { return null; }
}

// ── Variation generator — runs the pipeline once per mode ────────────────────
async function _generateVariants(modes, baseMemory, baseStructure, assetType, context) {
  const { applyVariationMode }      = require('./_shared/iteration-engine');
  const { buildHTMLBlueprint }      = require('./_shared/html-blueprint-builder');
  const { composeHTML }             = require('./_shared/html-composer');
  const { validateGeneric }         = require('./_shared/validators/anti-generic-validator');
  const { validateHTML }            = require('./_shared/validators/html-validator');
  const { validateVisual }          = require('./_shared/validators/visual-validator');
  const { saveAsset }               = require('./_shared/asset-storage');
  const { storeLastGeneratedAsset } = require('./_shared/feedback-loop');
  const crypto = require('crypto');

  const { businessProfile, profileName, userId } = context;
  const GRADE_EMOJI = { A: '🟢', B: '🟡', C: '🟠', D: '🔴', F: '🔴' };
  const results = [];

  for (const mode of modes) {
    try {
      const { structure: varStructure, memory: varMemory, label, description } =
        applyVariationMode(mode, baseStructure, baseMemory);

      const blueprint     = buildHTMLBlueprint(varStructure, null, varMemory);
      if (blueprint.meta) blueprint.meta.pixel_id = await _getPixelId(userId);
      const composeResult = composeHTML(blueprint);

      const genericResult = validateGeneric({ blueprint, composeResult, memory: varMemory });
      const htmlResult    = validateHTML(composeResult.html, { assetType });
      const visualResult  = validateVisual({ blueprint, html: composeResult.html, assetType });

      if (!genericResult.valid || !htmlResult.valid) {
        results.push({ mode, label, description, error: true });
        continue;
      }

      const pregenId   = crypto.randomUUID();
      const htmlWithId = composeResult.html.replace(/\{\{asset_id\}\}/g, pregenId);

      const saved = await saveAsset({
        userId,
        html:          htmlWithId,
        composeResult: { ...composeResult, html: htmlWithId },
        title: businessProfile.business_name
          ? `${businessProfile.business_name} — ${label}`
          : label,
        _pregenId: pregenId,
      });

      storeLastGeneratedAsset(userId, {
        asset_id:    saved.assetId,
        template_id: blueprint.template_id || null,
        asset_type:  assetType,
      }).catch(() => {});

      // Fire-and-forget: advance onboarding for variation creation
      const { advanceOnboarding: _adv } = require('./_shared/product-context');
      const _sb2 = getAdminClient();
      _adv(userId, _sb2, 'first_asset').catch(() => {});
      _sb2.from('generated_assets').select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .then(({ count }) => { if ((count || 0) >= 3) _adv(userId, _sb2, 'multiple_assets').catch(() => {}); })
        .catch(() => {});

      results.push({
        mode, label, description, error: false,
        previewUrl:   saved.previewUrl,
        expiresAt:    saved.expiresAt,
        assetId:      saved.assetId,
        sectionCount: Array.isArray(varStructure.sections) ? varStructure.sections.length : 0,
        grade:        visualResult.grade,
        score:        visualResult.combined_score,
      });

    } catch (err) {
      console.warn(`[campaigner-chat] variant "${mode}" failed:`, err.message);
      results.push({ mode, label: mode, description: '', error: true });
    }
  }

  // Build reply
  const firstOk  = results.find(r => !r.error);
  const expiryStr = firstOk ? new Date(firstOk.expiresAt).toLocaleDateString('he-IL') : null;
  const successN  = results.filter(r => !r.error).length;

  let reply = `📄 **${successN} וריאציות — ${businessProfile.business_name || profileName}**\n\n`;

  results.forEach((r, i) => {
    reply += `---\n\n**${i + 1}. ${r.label}**\n`;
    if (r.description) reply += `_${r.description}_\n`;
    if (r.error) {
      reply += `⚠️ _וריאציה זו לא נוצרה — ייתכן שחסר מידע עסקי._\n\n`;
    } else {
      reply += `🔗 \`${r.previewUrl}\`\n`;
      reply += `📐 ${r.sectionCount} סקשנים · ${GRADE_EMOJI[r.grade] || '⚪'} ציון: ${r.score}/100 (${r.grade})\n\n`;
    }
  });

  if (expiryStr) reply += `\n⏳ **תוקף:** ${expiryStr}\n`;
  reply += `\n💡 _הרץ A/B test בין הוריאציות כדי לגלות מה עובד הכי טוב לקהל שלך._`;

  return {
    reply,
    quickActions: ['נתח ביצועים', 'כתוב קופי מודעה', 'צור קריאייטיב ויזואלי'],
    variants: results.filter(r => !r.error).map(r => ({
      mode: r.mode, label: r.label, assetId: r.assetId, previewUrl: r.previewUrl,
    })),
  };
}

function _assetLabel(assetType) {
  return { landing_page_html: 'דף נחיתה', banner_html: 'באנר', ad_html: 'כרטיס מודעה', landing_hero: 'Hero Section' }[assetType] || 'דף נחיתה';
}

// ── Helper ────────────────────────────────────────────────────────────────────
function providerLabel(provider) {
  return { google_ads: 'Google Ads', ga4: 'Google Analytics 4', meta: 'Meta Ads' }[provider] || provider;
}

// ── General / conversational response — AI-powered, no integration required ───
async function generateGeneralResponse(context) {
  const { profileName, integrations, businessProfile, message, userId, strategyMemory } = context;
  const name     = profileName || 'חבר';
  const hasInteg = integrations.some(i => i.connection_status === 'active');
  const hasBP    = !!(businessProfile?.business_name);

  // Build rich context snippet for the AI
  const bpSnippet = hasBP
    ? `העסק: ${businessProfile.business_name}. מוכר: ${businessProfile.offer || '?'}. קהל: ${businessProfile.target_audience || '?'}. תקציב: ${businessProfile.monthly_budget ? '₪'+businessProfile.monthly_budget+'/חודש' : '?'}.`
    : 'אין עדיין פרופיל עסקי.';

  const integSnippet = hasInteg
    ? `מחובר ל: ${integrations.filter(i=>i.connection_status==='active').map(i=>i.provider).join(', ')}.`
    : 'אין עדיין אינטגרציות מחוברות.';

  const bottleneck = strategyMemory?.persistent_bottlenecks?.[0];
  const memSnippet = bottleneck ? `צוואר הבקבוק הכי בולט עד כה: ${bottleneck}.` : '';

  const systemPrompt = `אתה CampaignAI — סוכן שיווקי דיגיטלי חכם, ישיר ואנושי שמדבר עברית.
אתה מומחה ב: ניתוח קמפיינים, Google Ads, Meta Ads, GA4, קופי, ROAS, CAC, A/B testing, אסטרטגיה שיווקית.

הסגנון שלך:
- אנושי, חם אבל ישיר — לא רובוטי, לא גנרי
- מותאם לטון של המשתמש (פורמלי/לא פורמלי, קצר/ארוך, שאלות/הצהרות)
- תוכן ממשי — לא "אני יכול לעזור" אלא עזרה בפועל
- אם המשתמש אמר משהו ספציפי — הגב על זה ישירות
- אם זה פתיחת שיחה — הצג את עצמך בצורה שמתאימה לסיטואציה, לא תבנית קבועה

הקשר המשתמש:
שם: ${name}
${bpSnippet}
${integSnippet}
${memSnippet}

כללים:
- אל תפתח ב"היי [שם]! 👋" בכל הודעה — קרא מה המשתמש אמר והגב עליו
- אם המשתמש שאל שאלה — ענה עליה תחילה, אז הצע המשך
- אם אין אינטגרציות ושאלות הן שיווקיות — ענה מהידע שלך, לא תדרוש חיבור לפני כל תשובה
- סיים עם 1-2 שאלות פעילות שמקדמות את המשתמש
- תשובה: 3-8 משפטים, עברית בלבד, Markdown מותר`;

  try {
    const routing = await routeModel(message, 'chat');
    const raw = await OpenRouterAdapter.execute('chat', {
      system:    systemPrompt,
      user:      message,
      maxTokens: 500,
    }, {
      model:         routing.model,
      fallbackModel: routing.fallbackModel,
      timeout:       routing.timeoutMs || 15000,
      temperature:   0.8,
    });

    const reply = raw?.choices?.[0]?.message?.content?.trim();
    if (reply) {
      _logAICost({ userId, taskType: 'conversational', raw, routing }).catch(() => {});
      const qa = hasBP
        ? ['נתח ביצועים', 'כתוב לי קופי', 'הצעד הבא שלי', 'חשב ROAS']
        : ['ספר לי על העסק', 'כתוב לי מודעה', 'מה זה ROAS?', 'איך בונים קמפיין?'];
      return { reply, quickActions: qa };
    }
  } catch (e) {
    console.warn('[generalResponse] AI failed:', e.message);
  }

  // Fallback — minimal, contextual
  const fallback = hasBP
    ? `${name}, אני כאן. שאל אותי על הקמפיינים, הקופי, ה-ROAS — כל מה שצריך.`
    : `שלום ${name}! ספר לי על העסק שלך ואני אבנה לך תוכנית שיווקית. מה אתה מוכר?`;
  return {
    reply: fallback,
    quickActions: hasBP
      ? ['נתח ביצועים', 'כתוב קופי', 'ROAS שלי', 'הצעד הבא']
      : ['ספר על העסק', 'כתוב לי מודעה', 'מה זה ROAS?'],
  };
}

// ── Router ────────────────────────────────────────────────────────────────────
async function generateResponse(intent, context) {
  switch (intent) {
    case 'general':       return await generateGeneralResponse(context);
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
    case 'landing_page':  return await generateLandingPageResponse(context);
    default:              return await generateGeneralResponse(context);
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options();
  const context = createRequestContext(event, 'campaigner-chat');
  const _ilStart = Date.now();

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

    // ── Direct generation mode (from AI creation form — bypasses intent/beginner layers) ──
    if (message.startsWith('[DIRECT_AD]') || message.startsWith('[DIRECT_GENERATE]')) {
      const rawPrompt = message.replace(/^\[(DIRECT_AD|DIRECT_GENERATE)\]\s*/, '');

      let reply = '';
      try {
        // Route through model-router → OpenRouter (with Anthropic parachute)
        const routing = await routeModel(rawPrompt, 'creative');
        console.log('[direct-gen] routing:', routing.taskType, '→', routing.model, 'via', routing.useOpenRouter ? 'openrouter' : 'direct');

        const raw = await OpenRouterAdapter.execute('ad_copy', {
          system:    'אתה קופירייטר ישראלי מקצועי המתמחה בפרסום דיגיטלי. כתוב תוכן שיווקי בעברית, ישיר, ממיר ומשכנע. השב ישירות עם התוכן המבוקש בלבד, ללא הסברים נוספים.',
          user:      rawPrompt,
          maxTokens: 1500,
        }, {
          model:         routing.model,
          fallbackModel: routing.fallbackModel,
          timeout:       routing.timeoutMs,
          temperature:   routing.temperature,
        });

        reply = raw?.choices?.[0]?.message?.content || '';
        console.log('[direct-gen] reply length:', reply.length, '| via:', raw?._via, '| cost: $' + (raw?._cost || 0).toFixed(5));

        // Log cost (fire-and-forget)
        _logAICost({ userId: user.id, taskType: 'creative', raw, routing }).catch(() => {});

      } catch (e) {
        console.error('[direct-gen] error:', e.message);
        reply = '';
      }

      if (!reply) {
        return ok({ reply: '⚠️ שגיאה בגישה ל-AI. אנא נסה שנית.', quickActions: [] }, context.requestId);
      }
      return ok({ reply, quickActions: [] }, context.requestId);
    }

    // Build context from DB
    const chatContext = await buildContext(user.id);
    chatContext.message = message;   // thread raw message so generators can read it

    // Detect intent
    const intent = detectIntent(message);

    // NOTE: creation intents (creative, landing_page, copy) are handled inline
    // by generateCreativeResponse / generateLandingPageResponse / generateCopyResponse.

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

    const { reply, quickActions, imageData, assetId, previewUrl, expiresAt, copyVariants, pendingVisual } = responseData;

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

    iLogger.log({ agent_name: 'campaigner-chat', interaction_type: 'llm_call', status: 'SUCCESS', latency_ms: Date.now() - _ilStart, user_id: user?.id }).catch(() => {});
    const responsePayload = { reply, quickActions, intent };
    if (imageData)     responsePayload.imageData     = imageData;
    if (assetId)       responsePayload.assetId       = assetId;
    if (previewUrl)    responsePayload.previewUrl    = previewUrl;
    if (expiresAt)     responsePayload.expiresAt     = expiresAt;
    if (copyVariants)  responsePayload.copyVariants  = copyVariants;
    if (pendingVisual) responsePayload.pendingVisual = pendingVisual;
    return ok(responsePayload, context.requestId);

  } catch (error) {
    iLogger.log({ agent_name: 'campaigner-chat', interaction_type: 'llm_call', status: 'TECH_ERROR', latency_ms: Date.now() - _ilStart, error_details: error.message }).catch(() => {});
    await writeRequestLog(buildLogPayload(context, 'error', error.message || 'campaigner_chat_failed', {
      code: error.code || 'INTERNAL_ERROR',
    })).catch(() => {});
    return fail(error, context.requestId);
  }
};
