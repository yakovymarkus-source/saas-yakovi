'use strict';
/**
 * analysis/pipeline.js
 * 22-step Analysis Agent pipeline.
 * Orchestrates all analysis layers: ingestion → KPI → causality → anomalies
 * → insights → social → query-ready → AI narrative → persist.
 *
 * Extends (does NOT replace) analyze-service.js and decision-engine.js.
 * Uses existing providers, token manager, and persistence.
 */

const { createClient } = require('@supabase/supabase-js');

const { loadAllIntegrations } = require('../supabase');
const { ensureFreshToken }    = require('../token-manager');
const { persistAnalysis, getPreviousAnalysis } = require('../persistence');
const { runLearningEngine, persistStrategyMemory } = require('../learning-engine');
const { buildIterationAction } = require('../iteration-advisor');
const { orchestrate, CAPABILITIES } = require('../orchestrator');
const { loadBusinessProfile } = require('../business-profile');

const { normalizeProviders }  = require('./ingestion/data-normalizer');
const { buildKpiHierarchy }   = require('./kpi/kpi-engine');
const { analyzeCausality }    = require('./causality/causality-engine');
const { detectAnomalies }     = require('./anomalies/anomaly-detector');
const { generateInsights }    = require('./insights/insight-engine');
const { monitorSocialGrowth } = require('./social/growth-monitor');
const { answerQuery }         = require('./query/query-engine');

// Decision engine (existing, not replaced)
const { analyze: decisionAnalyze, normalizeMetrics, computeMetrics } = require('../decision-engine');

const TOTAL_STEPS = 22;

function _db() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

// ── Step logger ───────────────────────────────────────────────────────────────

async function _step(db, jobId, idx, key, message, status = 'done') {
  await db.from('analysis_steps').insert({ job_id: jobId, step_index: idx, step_key: key, message, status });
}

async function _fail(db, jobId, errorMessage) {
  await db.from('analysis_jobs').update({ status: 'failed', error_message: errorMessage }).eq('id', jobId);
}

// ── Main pipeline ─────────────────────────────────────────────────────────────

async function runAnalysisPipeline({ jobId, userId, campaignId, query = '', goal = 'leads', targets = {}, options = {} }) {
  const db      = _db();
  const startMs = Date.now();
  let stepIndex = 0;
  let aiCalls   = 0;

  async function step(key, message) {
    stepIndex += 1;
    await _step(db, jobId, stepIndex, key, message);
  }

  try {
    // ── Step 1: Initialize ─────────────────────────────────────────────────
    await step('init', 'מתחיל ניתוח קמפיין...');

    // ── Step 2: Load integrations ─────────────────────────────────────────
    await step('load_integrations', 'טוען חיבורי אינטגרציה...');
    const integrations = await loadAllIntegrations(userId);

    // ── Step 3: Fetch raw provider data ───────────────────────────────────
    await step('fetch_data', 'שולף נתונים מהפלטפורמות...');
    const { adsData, ga4Data, metaData, tiktokData } = await _fetchAllProviders(userId, integrations);

    // ── Step 4: Normalize + integrity check ────────────────────────────────
    await step('normalize', 'מנרמל נתונים לסכמה אחידה...');
    const rawProviders = { google_ads: adsData, ga4: ga4Data, meta: metaData, tiktok: tiktokData };
    const { unified, byPlatform, rows, integrity } = normalizeProviders(rawProviders);

    if (!integrity.passed) {
      const errMsg = integrity.errors.map(e => e.message).join('; ');
      await step('integrity_failed', `בעיית נתונים: ${errMsg}`);
    } else {
      await step('integrity_passed', `נתונים תקינים — ${rows.length} שורות עובדו`);
    }

    // ── Step 5: Load previous analysis for comparison ─────────────────────
    await step('load_previous', 'טוען ניתוח קודם להשוואה...');
    const previousResult = await getPreviousAnalysis(userId, campaignId).catch(() => null);
    const previousUnified = previousResult?.metrics || null;

    // ── Step 6: KPI engine ────────────────────────────────────────────────
    await step('kpi_engine', 'מחשב היררכיית KPI לפי מטרת הקמפיין...');
    const kpiHierarchy = buildKpiHierarchy(unified, goal, targets);

    // ── Step 7: Decision engine (existing — not replaced) ─────────────────
    await step('decision_engine', 'מפעיל מנוע ההחלטות...');
    const decisionResult = decisionAnalyze(unified);

    // ── Step 8: Causality engine ──────────────────────────────────────────
    await step('causality', 'מנתח סיבות לשינויים...');
    const causality = analyzeCausality(unified, previousUnified, { platform: 'aggregated', goal });

    // ── Step 9: Anomaly detection ─────────────────────────────────────────
    await step('anomaly_detection', 'מזהה אנומליות בנתונים...');
    const anomalies = detectAnomalies(unified, previousUnified, []);

    // ── Step 10: Social growth monitor ────────────────────────────────────
    await step('social_growth', 'מנתח גידול מדיה חברתית...');
    const social = monitorSocialGrowth(byPlatform, null);

    // ── Step 11: Insight engine ───────────────────────────────────────────
    await step('insights', 'מייצר תובנות מובנות...');
    const businessProfile = await loadBusinessProfile(userId).catch(() => null);
    const insightData = generateInsights({
      unified,
      kpiHierarchy,
      causality,
      anomalies,
      decisionResult,
      brief: { goal, businessProfile },
    });

    // ── Step 12: AI narrative ─────────────────────────────────────────────
    await step('ai_narrative', 'מייצר נרטיב עסקי עם AI...');
    let aiNarrative = null;
    try {
      const aiResult = await orchestrate(
        CAPABILITIES.ANALYSIS_SUMMARY,
        {
          unified,
          kpiHierarchy,
          anomalies: anomalies.signals,
          insights: insightData.priorities,
          causality: causality.chains,
          businessProfile: businessProfile || {},
        },
        { userId, requestId: jobId },
      );
      aiCalls++;
      if (aiResult.ok && aiResult.content) {
        aiNarrative = aiResult.content;
      }
    } catch (e) {
      console.warn('[analysis] AI narrative failed (non-fatal):', e.message);
    }

    // ── Step 13: Query engine (if query provided) ─────────────────────────
    await step('query_engine', query ? `עונה על שאלה: "${query.slice(0, 40)}..."` : 'אין שאלה ספציפית');
    const queryResult = query ? answerQuery(query, { unified, byPlatform, causality, anomalies, insights: insightData, social }) : null;

    // ── Step 14: Build final scores ────────────────────────────────────────
    await step('scoring', 'מחשב ציון כולל...');
    const scores = _buildAnalysisScores(unified, kpiHierarchy, anomalies, causality);

    // ── Step 15: Build decisions (extended) ───────────────────────────────
    await step('decisions', 'מגבש החלטות...');
    const decisions = _buildExtendedDecisions(unified, kpiHierarchy, anomalies, decisionResult);

    // ── Step 16: Build recommendations ────────────────────────────────────
    await step('recommendations', 'מייצר המלצות מועדפות...');
    const recommendations = _buildRecommendations(insightData.priorities, decisionResult, kpiHierarchy);

    // ── Step 17: Agent feedback loops ─────────────────────────────────────
    await step('feedback_loops', 'מכין משוב לסוכנים אחרים...');
    const agentFeedback = _buildAgentFeedback(anomalies, causality, kpiHierarchy, decisions);

    // ── Step 18: Learning engine (fire-and-forget) ────────────────────────
    await step('learning', 'מעדכן מנוע למידה...');
    runLearningEngine(userId, campaignId)
      .then(lr => {
        const iterationAction = buildIterationAction(causality.changes?.[0] || {}, lr, unified);
        return persistStrategyMemory(userId, campaignId, lr, iterationAction);
      })
      .catch(e => console.warn('[analysis] Learning update failed (non-fatal):', e.message));

    // ── Step 19: Persist base analysis ───────────────────────────────────
    await step('persist_analysis', 'שומר ניתוח בסיס...');
    const analysisId = await persistAnalysis({
      userId, campaignId, requestId: jobId,
      rawSnapshot: { providers: rawProviders, fetchedAt: new Date().toISOString() },
      metrics:     unified,
      scores,
      bottlenecks: decisionResult.issues?.map(i => i.stage) || [],
      decisions,
      recommendations,
      confidence:  integrity.passed ? 85 : 40,
    });

    // ── Step 20: Save full analysis report ───────────────────────────────
    await step('save_report', 'שומר דוח ניתוח מלא...');
    const reportPayload = {
      job_id:        jobId,
      user_id:       userId,
      campaign_id:   campaignId,
      analysis_id:   analysisId,
      unified:       unified,
      kpi_hierarchy: kpiHierarchy,
      causality:     causality,
      anomalies:     anomalies,
      social:        social,
      insights:      insightData,
      decisions,
      recommendations,
      agent_feedback: agentFeedback,
      query_result:  queryResult,
      ai_narrative:  aiNarrative,
      scores,
      integrity,
      ai_calls_used: aiCalls,
      generation_ms: Date.now() - startMs,
    };

    const { data: report, error: reportErr } = await db
      .from('analysis_reports')
      .insert(reportPayload)
      .select('id')
      .single();

    if (reportErr) throw new Error(`Failed to save analysis report: ${reportErr.message}`);

    // ── Step 21: Update job status ────────────────────────────────────────
    await step('finalize', 'מסיים ניתוח...');
    await db.from('analysis_jobs').update({
      status:        'completed',
      report_id:     report.id,
      overall_score: scores.overall,
      ai_calls_used: aiCalls,
      generation_ms: Date.now() - startMs,
    }).eq('id', jobId);

    // ── Step 22: Done ──────────────────────────────────────────────────────
    await step('done', `ניתוח הושלם — ציון ${scores.overall}/100`);

    return {
      ok:             true,
      jobId,
      reportId:       report.id,
      analysisId,
      scores,
      decisions,
      recommendations,
      insights:       insightData,
      anomalies,
      causality,
      social,
      kpiHierarchy,
      agentFeedback,
      queryResult,
      aiNarrative,
      generationMs:   Date.now() - startMs,
    };

  } catch (err) {
    console.error('[analysis-pipeline] Error:', err);
    await _fail(db, jobId, err.message);
    throw err;
  }
}

// ── Provider fetch helper ──────────────────────────────────────────────────────

async function _fetchAllProviders(userId, integrations) {
  const safe = fn => fn.catch(e => { console.warn('[analysis] Provider fetch failed:', e.message); return null; });

  const [adsData, ga4Data, metaData, tiktokData] = await Promise.all([
    integrations.has('google_ads') ? safe(_fetchGoogleAds(userId, integrations.get('google_ads'))) : null,
    integrations.has('ga4')        ? safe(_fetchGA4(userId, integrations.get('ga4')))               : null,
    integrations.has('meta')       ? safe(_fetchMeta(userId, integrations.get('meta')))             : null,
    integrations.has('tiktok')     ? safe(_fetchTiktok(userId, integrations.get('tiktok')))         : null,
  ]);

  return { adsData, ga4Data, metaData, tiktokData };
}

async function _fetchGoogleAds(userId, integration) {
  const { fetchCampaignMetrics, listAccessibleCustomers } = require('../integrations/google-ads');
  const fresh = await ensureFreshToken(userId, integration);
  const accessToken = fresh.secret?.accessToken;
  if (!accessToken) return null;
  let customerId = integration.account_id;
  if (!customerId) {
    const ids = await listAccessibleCustomers(accessToken);
    customerId = ids[0] || null;
  }
  if (!customerId) return null;
  const rows = await fetchCampaignMetrics({ customerId, accessToken, loginCustomerId: integration.metadata?.loginCustomerId || null });
  const totals = rows.reduce((a, r) => ({
    impressions: a.impressions + r.impressions, clicks: a.clicks + r.clicks,
    spend: a.spend + r.spend, conversions: a.conversions + r.conversions,
    conversionsValue: a.conversionsValue + (r.conversionsValue || 0),
  }), { impressions: 0, clicks: 0, spend: 0, conversions: 0, conversionsValue: 0 });
  return { source: 'google_ads', campaigns: rows, totals };
}

async function _fetchGA4(userId, integration) {
  const { fetchCampaignMetrics, listProperties } = require('../integrations/ga4');
  const fresh = await ensureFreshToken(userId, integration);
  const accessToken = fresh.secret?.accessToken;
  if (!accessToken) return null;
  let propertyId = integration.property_id;
  if (!propertyId) {
    const props = await listProperties(accessToken);
    propertyId = props[0]?.propertyId || null;
  }
  if (!propertyId) return null;
  const result = await fetchCampaignMetrics({ accessToken, propertyId });
  const totals = (result.rows || []).reduce((a, r) => ({
    sessions: a.sessions + (r.sessions || 0), conversions: a.conversions + (r.conversions || 0),
    revenue: a.revenue + (r.totalRevenue || 0),
  }), { sessions: 0, conversions: 0, revenue: 0 });
  return { source: 'ga4', rows: result.rows, totals, rowCount: result.rowCount };
}

async function _fetchMeta(userId, integration) {
  const { fetchCampaignInsights, listAdAccounts } = require('../integrations/meta');
  const fresh = await ensureFreshToken(userId, integration);
  const accessToken = fresh.secret?.accessToken;
  if (!accessToken) return null;
  let accountId = integration.account_id;
  if (!accountId) {
    const accounts = await listAdAccounts(accessToken);
    accountId = accounts[0]?.accountId || null;
  }
  if (!accountId) return null;
  const campaigns = await fetchCampaignInsights({ accessToken, accountId });
  const totals = campaigns.reduce((a, r) => ({
    impressions: a.impressions + r.impressions, clicks: a.clicks + r.clicks,
    spend: a.spend + r.spend, conversions: a.conversions + r.conversions,
    reach: a.reach + r.reach,
  }), { impressions: 0, clicks: 0, spend: 0, conversions: 0, reach: 0 });
  return { source: 'meta', campaigns, totals };
}

async function _fetchTiktok(userId, integration) {
  try {
    const { fetchCampaignMetrics } = require('../integrations/tiktok');
    const fresh = await ensureFreshToken(userId, integration);
    const accessToken = fresh.secret?.accessToken;
    if (!accessToken) return null;
    const result = await fetchCampaignMetrics({ accessToken, advertiserId: integration.account_id });
    return { source: 'tiktok', ...result };
  } catch { return null; }
}

// ── Score builder ──────────────────────────────────────────────────────────────

function _buildAnalysisScores(unified, kpiHierarchy, anomalies, causality) {
  const kpiScore      = (kpiHierarchy?.goal_score || 50);
  const dataScore     = unified.impressions > 1000 ? 80 : unified.impressions > 100 ? 60 : 30;
  const anomalyPenalty = (anomalies?.signals?.length || 0) * 10;
  const roasScore     = unified.roas >= 3 ? 90 : unified.roas >= 2 ? 75 : unified.roas >= 1 ? 55 : 30;

  const raw     = Math.round(kpiScore * 0.4 + dataScore * 0.2 + roasScore * 0.4);
  const overall = Math.max(0, Math.min(100, raw - anomalyPenalty));
  const verdict = overall >= 70 ? 'healthy' : overall >= 45 ? 'needs_improvement' : 'critical';

  return { overall, kpi: kpiScore, data: dataScore, roas: roasScore, verdict };
}

// ── Decision builder ───────────────────────────────────────────────────────────

function _buildExtendedDecisions(unified, kpiHierarchy, anomalies, decisionResult) {
  const decisions = [];
  const verdict   = kpiHierarchy?.goal_verdict || 'off_track';

  if (verdict === 'on_track') {
    decisions.push({ verdict: 'healthy', reason: 'הקמפיין עומד ביעדי ה-KPI', confidence: 85, source: 'kpi_engine' });
  } else if (anomalies?.severity === 'critical') {
    decisions.push({ verdict: 'critical', reason: anomalies.summary, confidence: 88, source: 'anomaly_detector' });
  } else {
    decisions.push({ verdict: 'needs_work', reason: `KPI verdict: ${verdict}`, confidence: 80, source: 'kpi_engine' });
  }

  // Also include decision engine signals
  if (decisionResult?.issues?.length) {
    const top = decisionResult.issues[0];
    decisions.push({ verdict: top.verdictType || 'signal', reason: top.reason, confidence: Math.round((top.confidence || 0.7) * 100), source: 'decision_engine' });
  }

  return decisions;
}

// ── Recommendation builder ─────────────────────────────────────────────────────

function _buildRecommendations(priorities, decisionResult, kpiHierarchy) {
  const recs = (priorities || []).slice(0, 5).map(ins => ({
    issue:          ins.what,
    rootCause:      ins.why,
    action:         ins.impact,
    urgency:        ins.priority === 'critical' ? 95 : ins.priority === 'high' ? 80 : 60,
    confidence:     Math.round((ins.confidence || 0.7) * 100),
    source:         ins.category,
  }));

  // Enrich with decision engine actions
  const engineActions = decisionResult?.prioritizedActions?.slice(0, 3) || [];
  for (const action of engineActions) {
    if (!recs.some(r => r.issue === action.title)) {
      recs.push({
        issue:      action.title,
        rootCause:  action.why,
        action:     action.expectedImpact,
        urgency:    action.urgency * 10,
        confidence: 80,
        source:     'decision_engine',
      });
    }
  }

  return recs.sort((a, b) => b.urgency - a.urgency);
}

// ── Agent feedback ─────────────────────────────────────────────────────────────

function _buildAgentFeedback(anomalies, causality, kpiHierarchy, decisions) {
  const feedback = { to_execution: null, to_strategy: null, to_qa: null };

  const topAnomaly = anomalies?.signals?.[0];
  if (topAnomaly) {
    if (['ctr_critically_low', 'clicks_without_conversions'].includes(topAnomaly.code)) {
      feedback.to_execution = {
        signal:  topAnomaly.code,
        message: `בעיית ביצוע: ${topAnomaly.message}`,
        action:  topAnomaly.action,
      };
    }
  }

  if (kpiHierarchy?.goal_verdict === 'off_track') {
    const topChain = causality?.chains?.[0];
    feedback.to_strategy = {
      signal:  'goal_off_track',
      message: topChain ? `${topChain.change}: ${topChain.reason}` : 'יעדים לא מושגים',
      action:  topChain?.recommended_actions?.[0] || 'בחן מחדש אסטרטגיה',
    };
  }

  return feedback;
}

module.exports = { runAnalysisPipeline, TOTAL_STEPS };
