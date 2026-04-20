'use strict';
/**
 * analysis/pipeline.js
 * 30-step Analysis Agent pipeline — full protocol.
 * Orchestrates all analysis layers without overwriting existing services.
 */

const { createClient } = require('@supabase/supabase-js');

const { loadAllIntegrations } = require('../supabase');
const { ensureFreshToken }    = require('../token-manager');
const { persistAnalysis, getPreviousAnalysis } = require('../persistence');
const { runLearningEngine, persistStrategyMemory } = require('../learning-engine');
const { buildIterationAction } = require('../iteration-advisor');
const { orchestrate, CAPABILITIES } = require('../orchestrator');
const { loadBusinessProfile } = require('../business-profile');

// ── New analysis layers ───────────────────────────────────────────────────────
const { normalizeProviders }    = require('./ingestion/data-normalizer');
const { buildKpiHierarchy }     = require('./kpi/kpi-engine');
const { analyzeCausality }      = require('./causality/causality-engine');
const { detectAnomalies }       = require('./anomalies/anomaly-detector');
const { generateInsights }      = require('./insights/insight-engine');
const { monitorSocialGrowth }   = require('./social/growth-monitor');
const { answerQuery }           = require('./query/query-engine');
const { analyzeFunnel }         = require('./engines/funnel-analyzer');
const { analyzeTrends }         = require('./engines/trend-analyzer');
const { runAttribution }        = require('./engines/attribution-engine');
const { analyzeBusinessLayer }  = require('./engines/business-layer');
const { generateExperiments }   = require('./engines/experiment-engine');
const { buildAlerts }           = require('./alerts/alert-engine');
const { analyzeTradeoffs }      = require('./engines/tradeoff-engine');
const { matchPatterns, buildPriorityRanking } = require('./engines/pattern-library');
const { buildAnalysisOutput }   = require('./output/output-builder');

// ── Existing engines (not replaced) ──────────────────────────────────────────
const { analyze: decisionAnalyze } = require('../decision-engine');

const TOTAL_STEPS = 30;

function _db() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

async function _step(db, jobId, idx, key, message) {
  await db.from('analysis_steps').insert({ job_id: jobId, step_index: idx, step_key: key, message, status: 'done' });
}

async function _fail(db, jobId, msg) {
  await db.from('analysis_jobs').update({ status: 'failed', error_message: msg }).eq('id', jobId);
}

// ── Main pipeline ─────────────────────────────────────────────────────────────

async function runAnalysisPipeline({ jobId, userId, campaignId, query = '', goal = 'leads', targets = {}, options = {} }) {
  const db      = _db();
  const startMs = Date.now();
  let stepIndex = 0;
  let aiCalls   = 0;

  const step = async (key, message) => { stepIndex++; await _step(db, jobId, stepIndex, key, message); };

  try {
    // 1. Init
    await step('init', 'מתחיל ניתוח...');

    // 2. Load integrations
    await step('load_integrations', 'טוען חיבורי אינטגרציה...');
    const integrations = await loadAllIntegrations(userId);

    // 3. Fetch data from all providers
    await step('fetch_data', 'שולף נתונים מהפלטפורמות...');
    const { adsData, ga4Data, metaData, tiktokData } = await _fetchAllProviders(userId, integrations);

    // 4. Normalize to unified schema
    await step('normalize', 'מנרמל נתונים...');
    const rawProviders = { google_ads: adsData, ga4: ga4Data, meta: metaData, tiktok: tiktokData };
    const { unified, byPlatform, rows, integrity } = normalizeProviders(rawProviders);

    // 5. Integrity check
    await step('integrity_check', integrity.passed ? `נתונים תקינים (${rows.length} שורות)` : `בעיית נתונים: ${integrity.errors.map(e=>e.message).join('; ')}`);

    // 6. Load previous analysis
    await step('load_previous', 'טוען ניתוח קודם...');
    const prevResult   = await getPreviousAnalysis(userId, campaignId).catch(() => null);
    const prevUnified  = prevResult?.metrics || null;

    // 7. KPI engine
    await step('kpi_engine', `בונה KPI hierarchy למטרה: ${goal}...`);
    const kpiHierarchy = buildKpiHierarchy(unified, goal, targets);

    // 8. Decision engine (existing — not replaced)
    await step('decision_engine', 'מפעיל מנוע החלטות...');
    const decisionResult = decisionAnalyze(unified);

    // 9. Funnel analysis
    await step('funnel_analysis', 'מנתח משפך שיווקי...');
    const funnelResult = analyzeFunnel(unified);

    // 10. Causality engine
    await step('causality', 'מנתח סיבות לשינויים...');
    const causality = analyzeCausality(unified, prevUnified, { platform: 'aggregated', goal });

    // 11. Trend analysis
    await step('trend_analysis', 'מזהה מגמות...');
    const trendResult = analyzeTrends(unified, [], []); // history loaded from prevResult if available

    // 12. Anomaly detection
    await step('anomaly_detection', 'מזהה אנומליות...');
    const anomalies = detectAnomalies(unified, prevUnified, []);

    // 13. Social growth
    await step('social_growth', 'מנתח גידול מדיה חברתית...');
    const social = monitorSocialGrowth(byPlatform, null);

    // 14. Attribution
    await step('attribution', 'מחשב ייחוס לפי ערוץ...');
    const attribution = runAttribution(unified, byPlatform, [], { goal });

    // 15. Business layer
    await step('business_layer', 'מנתח יחידת כלכלה (LTV/CAC/ROAS)...');
    const businessProfile = await loadBusinessProfile(userId).catch(() => null);
    const businessLayer   = analyzeBusinessLayer(unified, businessProfile || {}, { goal });

    // 16. Tradeoff engine
    await step('tradeoff_engine', 'מזהה פשרות ומכייל ביטחון...');
    const tradeoffs = analyzeTradeoffs(unified, prevUnified, kpiHierarchy);

    // 17. Pattern library
    await step('pattern_matching', 'מחפש דפוסים מוכרים...');
    const patterns = matchPatterns(unified);

    // 18. Insight engine
    await step('insights', 'מייצר תובנות...');
    const insightData = generateInsights({
      unified, kpiHierarchy, causality, anomalies, decisionResult,
      brief: { goal, businessProfile },
    });

    // 19. Experiment engine
    await step('experiments', 'מייצר הצעות ניסויים...');
    const experiments = generateExperiments({
      anomalies, funnelResult, trendResult, kpiHierarchy,
    });

    // 20. Alert engine
    await step('alerts', 'בונה התראות...');
    const alerts = buildAlerts({
      anomalies, businessLayer, funnelResult, causality, kpiHierarchy, unified,
    });

    // 21. Priority ranking
    await step('priority_ranking', 'מדרג פעולות לפי עדיפות...');
    const priorityRanking = buildPriorityRanking({
      insights: insightData, anomalies, funnelResult, experiments, tradeoffs, businessLayer, patterns,
    });

    // 22. AI narrative
    await step('ai_narrative', 'מייצר נרטיב עסקי...');
    let aiNarrative = null;
    try {
      const aiResult = await orchestrate(
        CAPABILITIES.ANALYSIS_SUMMARY,
        { unified, kpiHierarchy, anomalies: anomalies.signals, insights: insightData.priorities, causality: causality.chains, businessProfile: businessProfile || {} },
        { userId, requestId: jobId },
      );
      aiCalls++;
      if (aiResult.ok && aiResult.content) aiNarrative = aiResult.content;
    } catch (e) { console.warn('[analysis] AI narrative failed:', e.message); }

    // 23. Query engine
    await step('query_engine', query ? `עונה: "${query.slice(0,40)}"` : 'אין שאלה ספציפית');
    const queryResult = query ? answerQuery(query, { unified, byPlatform, causality, anomalies, insights: insightData, social }) : null;

    // 24. Build final output
    await step('build_output', 'בונה פלט סטנדרטי...');
    const finalOutput = buildAnalysisOutput({
      unified, kpiHierarchy, causality, anomalies, funnel: funnelResult,
      trends: trendResult, attribution, businessLayer, experiments,
      alerts, insights: insightData, social, tradeoffs, patterns,
      priorityRanking, queryResult, aiNarrative,
      scores: _buildScores(unified, kpiHierarchy, anomalies, businessLayer),
      integrity, brief: { goal, businessProfile },
    });

    // Failure mode: return early
    if (finalOutput.status !== 'ok') {
      await db.from('analysis_jobs').update({ status: 'failed', error_message: finalOutput.message }).eq('id', jobId);
      return { ok: false, ...finalOutput };
    }

    // 25. Persist base analysis
    await step('persist_analysis', 'שומר ניתוח בסיס...');
    const analysisId = await persistAnalysis({
      userId, campaignId, requestId: jobId,
      rawSnapshot: { providers: rawProviders, fetchedAt: new Date().toISOString() },
      metrics:     unified,
      scores:      finalOutput.scores,
      bottlenecks: decisionResult.issues?.map(i => i.stage) || [],
      decisions:   finalOutput.decisions,
      recommendations: priorityRanking.priority_list?.slice(0, 5).map(p => ({ issue: p.action, rootCause: p.why, action: p.action, urgency: p.urgency, confidence: 80, source: p.source })) || [],
      confidence:  integrity.passed ? 85 : 40,
    });

    // 26. Save full report
    await step('save_report', 'שומר דוח ניתוח מלא...');
    const { data: report, error: reportErr } = await db.from('analysis_reports').insert({
      job_id:        jobId,
      user_id:       userId,
      campaign_id:   campaignId,
      analysis_id:   analysisId,
      unified:       finalOutput.metrics,
      kpi_hierarchy: finalOutput.kpi,
      causality:     finalOutput.causality,
      anomalies:     finalOutput.anomalies,
      social:        finalOutput.social,
      insights:      { priorities: finalOutput.insights, narrative: finalOutput.summary?.narrative },
      decisions:     finalOutput.decisions,
      recommendations: priorityRanking.priority_list,
      agent_feedback: finalOutput.agent_feedback,
      query_result:  finalOutput.query_result,
      ai_narrative:  finalOutput.ai_narrative,
      scores:        finalOutput.scores,
      integrity:     finalOutput.integrity,
      // Extended fields
      funnel:        finalOutput.funnel,
      trends:        finalOutput.trends,
      attribution:   finalOutput.attribution,
      business:      finalOutput.business,
      experiments:   { suggested: finalOutput.experiments },
      alerts:        { alerts: finalOutput.alerts, total: alerts.total, has_critical: alerts.has_critical },
      tradeoffs:     finalOutput.tradeoffs,
      patterns:      finalOutput.patterns,
      priority_actions: finalOutput.priority_actions,
      system_impact: finalOutput.system_impact,
      uncertainty:   finalOutput.uncertainty,
      ai_calls_used: aiCalls,
      generation_ms: Date.now() - startMs,
    }).select('id').single();

    if (reportErr) throw new Error(`Failed to save report: ${reportErr.message}`);

    // 27. Learning engine (fire-and-forget)
    await step('learning', 'מעדכן מנוע למידה...');
    runLearningEngine(userId, campaignId)
      .then(lr => {
        const iterAction = buildIterationAction(causality.changes?.[0] || {}, lr, unified);
        return persistStrategyMemory(userId, campaignId, lr, iterAction);
      })
      .catch(e => console.warn('[analysis] Learning failed (non-fatal):', e.message));

    // 28. Update job
    await step('update_job', 'מעדכן סטטוס...');
    await db.from('analysis_jobs').update({
      status:        'completed',
      report_id:     report.id,
      overall_score: finalOutput.scores?.overall || 0,
      ai_calls_used: aiCalls,
      generation_ms: Date.now() - startMs,
    }).eq('id', jobId);

    // 29. Log alerts
    await step('log_alerts', `${alerts.total} התראות — ${alerts.has_critical ? '🚨 קריטי' : '✅ תקין'}`);

    // 30. Done
    await step('done', `✅ ניתוח הושלם — ציון ${finalOutput.scores?.overall || 0}/100`);

    return {
      ok:             true,
      jobId,
      reportId:       report.id,
      analysisId,
      output:         finalOutput,
      generationMs:   Date.now() - startMs,
    };

  } catch (err) {
    console.error('[analysis-pipeline]', err);
    await _fail(db, jobId, err.message);
    throw err;
  }
}

// ── Scoring ───────────────────────────────────────────────────────────────────

function _buildScores(unified, kpiHierarchy, anomalies, businessLayer) {
  const kpiScore      = kpiHierarchy?.goal_score || 50;
  const dataScore     = unified.impressions > 1000 ? 80 : unified.impressions > 100 ? 60 : 30;
  const roasScore     = unified.roas >= 3 ? 90 : unified.roas >= 2 ? 75 : unified.roas >= 1 ? 55 : 30;
  const anomalyPenalty = Math.min(40, (anomalies?.signals?.length || 0) * 10);
  const bizScore      = businessLayer?.unit_economics?.ltv_cac_health === 'excellent' ? 90
    : businessLayer?.unit_economics?.ltv_cac_health === 'good' ? 75
    : businessLayer?.unit_economics?.ltv_cac_health === 'break_even' ? 50 : 30;

  const raw     = Math.round(kpiScore * 0.35 + dataScore * 0.15 + roasScore * 0.30 + bizScore * 0.20);
  const overall = Math.max(0, Math.min(100, raw - anomalyPenalty));
  const verdict = overall >= 70 ? 'healthy' : overall >= 45 ? 'needs_improvement' : 'critical';

  return { overall, kpi: kpiScore, data: dataScore, roas: roasScore, business: bizScore, verdict };
}

// ── Provider fetchers ─────────────────────────────────────────────────────────

async function _fetchAllProviders(userId, integrations) {
  const safe = fn => Promise.resolve(fn).catch(e => { console.warn('[analysis] fetch failed:', e.message); return null; });

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
  if (!customerId) { const ids = await listAccessibleCustomers(accessToken); customerId = ids[0] || null; }
  if (!customerId) return null;
  const rows = await fetchCampaignMetrics({ customerId, accessToken, loginCustomerId: integration.metadata?.loginCustomerId || null });
  const totals = rows.reduce((a, r) => ({ impressions: a.impressions + r.impressions, clicks: a.clicks + r.clicks, spend: a.spend + r.spend, conversions: a.conversions + r.conversions, conversionsValue: a.conversionsValue + (r.conversionsValue || 0) }), { impressions: 0, clicks: 0, spend: 0, conversions: 0, conversionsValue: 0 });
  return { source: 'google_ads', campaigns: rows, totals };
}

async function _fetchGA4(userId, integration) {
  const { fetchCampaignMetrics, listProperties } = require('../integrations/ga4');
  const fresh = await ensureFreshToken(userId, integration);
  const accessToken = fresh.secret?.accessToken;
  if (!accessToken) return null;
  let propertyId = integration.property_id;
  if (!propertyId) { const props = await listProperties(accessToken); propertyId = props[0]?.propertyId || null; }
  if (!propertyId) return null;
  const result = await fetchCampaignMetrics({ accessToken, propertyId });
  const totals = (result.rows || []).reduce((a, r) => ({ sessions: a.sessions + (r.sessions || 0), conversions: a.conversions + (r.conversions || 0), revenue: a.revenue + (r.totalRevenue || 0) }), { sessions: 0, conversions: 0, revenue: 0 });
  return { source: 'ga4', rows: result.rows, totals };
}

async function _fetchMeta(userId, integration) {
  const { fetchCampaignInsights, listAdAccounts } = require('../integrations/meta');
  const fresh = await ensureFreshToken(userId, integration);
  const accessToken = fresh.secret?.accessToken;
  if (!accessToken) return null;
  let accountId = integration.account_id;
  if (!accountId) { const accounts = await listAdAccounts(accessToken); accountId = accounts[0]?.accountId || null; }
  if (!accountId) return null;
  const campaigns = await fetchCampaignInsights({ accessToken, accountId });
  const totals = campaigns.reduce((a, r) => ({ impressions: a.impressions + r.impressions, clicks: a.clicks + r.clicks, spend: a.spend + r.spend, conversions: a.conversions + r.conversions, reach: a.reach + r.reach }), { impressions: 0, clicks: 0, spend: 0, conversions: 0, reach: 0 });
  return { source: 'meta', campaigns, totals };
}

async function _fetchTiktok(userId, integration) {
  try {
    const { fetchCampaignMetrics } = require('../integrations/tiktok');
    const fresh = await ensureFreshToken(userId, integration);
    const accessToken = fresh.secret?.accessToken;
    if (!accessToken) return null;
    return await fetchCampaignMetrics({ accessToken, advertiserId: integration.account_id });
  } catch { return null; }
}

module.exports = { runAnalysisPipeline, TOTAL_STEPS };
