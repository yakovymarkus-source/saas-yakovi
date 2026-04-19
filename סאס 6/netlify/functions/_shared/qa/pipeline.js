'use strict';
/**
 * qa/pipeline.js
 * 19-step QA Agent pipeline — full protocol: 20 check categories (deterministic + AI + simulation).
 * Deterministic + AI checks + simulation + routing.
 */

const { createClient } = require('@supabase/supabase-js');

const {
  checkCognitiveLoad,
  detectKillSignals,
  checkLanguage,
  checkAwarenessMatch,
  checkTrustSignals,
  checkTracking,
  checkEndToEndFlow,
  checkFrictionPoints,
  checkLpHierarchy,
  checkImplementationReadiness,
  checkMarketSaturationFit,
  checkMessageClarity,
} = require('./core/checks');

const { runSimulation }      = require('./core/simulation-engine');
const { buildTestPlan }      = require('./core/test-plan-builder');

const {
  evaluateHooks,
  evaluatePainAndDifferentiation,
  evaluateOfferAndPersuasion,
  compareVariants,
  generateCorrections,
  evaluateEdgeCasesAndIntentDrift,
  evaluateExecutionFidelity,
  evaluateBusinessAndScalability,
} = require('./collectors/claude-qa-engine');

const { buildRoutingDecision } = require('./output/routing-engine');
const { buildQaReport }        = require('./output/qa-report-builder');

function _supabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

async function runQaPipeline({ jobId, userId, executionReport, researchReport }) {
  const db       = _supabase();
  const startMs  = Date.now();
  let stepIndex  = 0;
  let aiCalls    = 0;

  async function step(key, message, fn) {
    stepIndex++;
    await db.from('qa_steps').insert({ job_id: jobId, step_index: stepIndex, step_key: key, message, status: 'running' });
    try {
      const result = await fn();
      await db.from('qa_steps')
        .update({ status: 'done', data: result ? JSON.parse(JSON.stringify(result)) : null })
        .eq('job_id', jobId).eq('step_key', key);
      return result;
    } catch (err) {
      await db.from('qa_steps')
        .update({ status: 'error', data: { error: err.message } })
        .eq('job_id', jobId).eq('step_key', key);
      throw err;
    }
  }

  // ── Step 1: Extract assets from execution report ──────────────────────────
  const assets = await step('extract_assets', 'טוען נכסים מדוח ביצוע', async () => {
    const bundle = executionReport?.assets || executionReport?.campaign_assets || {};
    if (!bundle || Object.keys(bundle).length === 0) throw new Error('אין נכסים בדוח ביצוע');
    return bundle;
  });

  const brief          = executionReport?.brief || {};
  const offer          = executionReport?.message_core?.offer || {};
  const trackingLayer  = executionReport?.tracking || {};
  const researchCtx    = researchReport?.analysis || researchReport || {};
  const decisionLayer  = executionReport?.decision_layer || {};

  // ── Step 2: Kill Signals (fast — decides if we even continue deeply) ──────
  const killSignals = await step('kill_signals', 'מזהה Kill Signals קריטיים', async () => {
    return detectKillSignals(assets, brief);
  });

  // ── Step 3: Cognitive Load ─────────────────────────────────────────────────
  const cognitiveLoad = await step('cognitive_load', 'בדיקת עומס קוגניטיבי', async () => {
    return checkCognitiveLoad(assets);
  });

  // ── Step 4: Language Check ────────────────────────────────────────────────
  const language = await step('language_check', 'בדיקת שפה — חד/גנרי/רובוטי', async () => {
    return checkLanguage(assets, brief);
  });

  // ── Step 5: Awareness Match ────────────────────────────────────────────────
  const awareness = await step('awareness_match', 'בדיקת התאמה לרמת מודעות', async () => {
    return checkAwarenessMatch(assets, decisionLayer.awarenessLevel || brief.awarenessLevel);
  });

  // ── Step 6: Trust Signals ─────────────────────────────────────────────────
  const trust = await step('trust_signals', 'בדיקת אלמנטי אמון', async () => {
    return checkTrustSignals(assets);
  });

  // ── Step 7: Tracking Validation ───────────────────────────────────────────
  const tracking = await step('tracking_validation', 'ולידציית Pixel & Events', async () => {
    return checkTracking(trackingLayer);
  });

  // ── Step 8: End-to-End Flow ───────────────────────────────────────────────
  const flow = await step('flow_check', 'בדיקת זרימה מלאה מודעה → דף → פעולה', async () => {
    return checkEndToEndFlow(assets, brief);
  });

  // ── Step 9: AI — Hook Strength ────────────────────────────────────────────
  const hookEval = await step('hook_evaluation', 'AI: הערכת עוצמת הוקים', async () => {
    const result = await evaluateHooks({ hooks: assets.hooks, brief, researchContext: researchCtx });
    aiCalls++;
    return result;
  });

  // ── Step 10: AI — Pain & Differentiation ─────────────────────────────────
  const painDiff = await step('pain_differentiation', 'AI: עומק כאב + בידול', async () => {
    const result = await evaluatePainAndDifferentiation({ assets, brief, researchContext: researchCtx });
    aiCalls++;
    return result;
  });

  // ── Step 11: AI — Offer & Persuasion ─────────────────────────────────────
  const offerPersuasion = await step('offer_persuasion', 'AI: הצעה + רצף שכנוע', async () => {
    const result = await evaluateOfferAndPersuasion({ assets, brief, offer });
    aiCalls++;
    return result;
  });

  // ── Step 12: AI — Variant Comparison ─────────────────────────────────────
  const variantRanking = await step('variant_comparison', 'AI: השוואת וריאנטים', async () => {
    const result = await compareVariants({ assets, brief });
    aiCalls++;
    return result;
  });

  // ── Step 13: Friction Points + LP Hierarchy + Implementation + Market Fit ──
  let frictionCheck, lpHierarchy, implementationCheck, marketSatCheck, messageClarity;
  await step('advanced_checks', 'בדיקות מתקדמות: friction / hierarchy / readiness / saturation', async () => {
    frictionCheck      = checkFrictionPoints(assets);
    lpHierarchy        = checkLpHierarchy(assets);
    implementationCheck= checkImplementationReadiness(assets);
    marketSatCheck     = checkMarketSaturationFit(assets, researchCtx);
    messageClarity     = checkMessageClarity(assets);
    return {
      friction:       frictionCheck.friction_level,
      lp_hierarchy:   lpHierarchy.passed,
      ready:          implementationCheck.can_deploy_now,
      saturation:     marketSatCheck.saturation_level,
      message_clarity: messageClarity.clear_in_2sec,
    };
  });

  // ── Step 13b: AI — Edge Cases + Intent Drift ──────────────────────────────
  let edgeCases;
  await step('edge_cases', 'AI: Edge Cases (סקפטי/קר/ניסה) + Intent Drift', async () => {
    edgeCases = await evaluateEdgeCasesAndIntentDrift({ assets, brief });
    aiCalls++;
    return { score: edgeCases.edge_case_score, intent_drift: edgeCases.intent_drift?.exists };
  });

  // ── Step 13c: AI — Execution Fidelity + Visual QA ────────────────────────
  let executionFidelity;
  await step('execution_fidelity', 'AI: נאמנות ביצוע לאסטרטגיה + Visual QA', async () => {
    executionFidelity = await evaluateExecutionFidelity({ assets, brief, decisionLayer });
    aiCalls++;
    return { score: executionFidelity.fidelity_score, platform_fit: executionFidelity.platform_format_fit };
  });

  // ── Step 13d: AI — Business Fit + ROI + Scalability + Fatigue ────────────
  let businessAnalysis;
  await step('business_analysis', 'AI: Business Fit + ROI + Scalability + Content Fatigue', async () => {
    businessAnalysis = await evaluateBusinessAndScalability({ assets, brief, offer });
    aiCalls++;
    return { roi: businessAnalysis.roi_outlook, scalable: businessAnalysis.scalable, fatigue: businessAnalysis.fatigue_risk };
  });

  // ── Step 14: Simulation ───────────────────────────────────────────────────
  const simulation = await step('simulation', 'סימולציית ביצוע: scroll / click / conversion + ROI', async () => {
    return runSimulation({
      hookScore:           hookEval.overall_hook_score      || 50,
      offerScore:          offerPersuasion.offer_score      || 50,
      trustScore:          trust.score                      || 50,
      ctaScore:            language.score                   || 50,
      awarenessMatchScore: awareness.passed ? 80 : 40,
      cognitiveLoadScore:  cognitiveLoad.score              || 50,
      platform:            brief.platform,
      brief,
    });
  });

  // ── Collect all issues ─────────────────────────────────────────────────────
  const allIssues = _collectAllIssues({
    killSignals, cognitiveLoad, language, awareness, trust, tracking, flow,
    hookEval, painDiff, offerPersuasion,
    frictionCheck, lpHierarchy, implementationCheck, marketSatCheck, messageClarity,
    edgeCases, executionFidelity, businessAnalysis,
  });

  // ── Step 14: AI — Generate Corrections ───────────────────────────────────
  const corrections = await step('generate_corrections', 'AI: הוראות תיקון מדויקות', async () => {
    const result = await generateCorrections({ allIssues, assets, brief });
    aiCalls++;
    return result;
  });

  // ── Step 14b: Build Test Plan ─────────────────────────────────────────────
  const testPlan = await step('test_plan', 'בניית תוכנית A/B Testing', async () => {
    return buildTestPlan({
      assets,
      qaChecks:     { languageIssues: language.issues || [] },
      brief,
      variantCount: (assets.ads || []).length,
    });
  });

  // ── Step 15: Routing Decision ─────────────────────────────────────────────
  const qaScores = {
    overall:       0,
    hook:          hookEval.overall_hook_score     || 50,
    trust:         trust.score                     || 50,
    differentiation: painDiff.differentiation?.score || 50,
  };

  const checks = {
    hook:              hookEval,
    pain:              painDiff,
    differentiation:   { score: painDiff.differentiation?.score, unique: painDiff.differentiation?.unique },
    offer:             offerPersuasion,
    persuasion:        { persuasion_score: offerPersuasion.persuasion_score, persuasion_flow: offerPersuasion.persuasion_flow },
    language,
    awareness,
    cognitiveLoad,
    trust,
    tracking,
    flow,
    killSignals,
    // New checks
    friction:          frictionCheck,
    lp_hierarchy:      lpHierarchy,
    implementation:    implementationCheck,
    market_saturation: marketSatCheck,
    message_clarity:   messageClarity,
    edge_cases:        edgeCases,
    execution_fidelity: executionFidelity,
    business:          businessAnalysis,
  };

  const routing = await step('routing_decision', 'החלטת ניתוב — approve/improve/reject + שולח לסוכן', async () => {
    // Temp score to decide verdict before full report
    const tempOverall = _quickScore(checks);
    const verdict     = tempOverall >= 72 ? 'approve' : tempOverall >= 45 ? 'improve' : 'reject';
    return buildRoutingDecision({ verdict, allIssues, killSignals, corrections, brief, qaScores: { ...qaScores, overall: tempOverall } });
  });

  // ── Build Report ───────────────────────────────────────────────────────────
  const generationMs = Date.now() - startMs;
  const report = buildQaReport({
    brief, executionReportId: executionReport?.id || executionReport?.job_id,
    researchReportId: researchReport?.id,
    checks, simulation, variantRanking, corrections, testPlan, routing,
    allIssues, aiCallsMade: aiCalls, generationMs,
  });

  // ── Save ──────────────────────────────────────────────────────────────────
  let reportId;
  await step('save_report', 'שומר דוח QA ל-DB', async () => {
    const { data, error } = await db.from('qa_reports').insert({
      job_id:             jobId,
      user_id:            userId,
      execution_report_id: executionReport?.id || null,
      research_report_id:  researchReport?.id  || null,
      verdict:            report.verdict,
      overall_score:      report.overall_score,
      checks:             report.checks,
      simulation:         report.simulation,
      corrections:        report.corrections,
      routing:            report.routing,
      test_plan:          report.test_plan,
      all_issues:         allIssues,
      ai_calls_made:      aiCalls,
      generation_ms:      generationMs,
    }).select('id').single();
    if (error) throw new Error(error.message);
    reportId = data.id;
    return { reportId };
  });

  // ── Finalize ──────────────────────────────────────────────────────────────
  await step('finalize', 'מסיים ומעדכן סטטוס', async () => {
    await db.from('qa_jobs').update({
      status:        'completed',
      report_id:     reportId,
      verdict:       report.verdict,
      overall_score: report.overall_score,
      ai_calls_used: aiCalls,
      generation_ms: generationMs,
      completed_at:  new Date().toISOString(),
    }).eq('id', jobId);
    return { success: true, reportId, verdict: report.verdict };
  });

  return { success: true, reportId, verdict: report.verdict, overallScore: report.overall_score, routing };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function _collectAllIssues({ killSignals, cognitiveLoad, language, awareness, trust, tracking, flow,
  hookEval, painDiff, offerPersuasion,
  frictionCheck, lpHierarchy, implementationCheck, marketSatCheck, messageClarity,
  edgeCases, executionFidelity, businessAnalysis }) {
  const issues = [];

  // ── Original checks ────────────────────────────────────────────────────────
  for (const s of (killSignals?.signals || []))  issues.push({ source: 'kill_signals',    issue: s.description,  severity: s.severity,              fix: s.fix });
  for (const i of (cognitiveLoad?.issues || []))  issues.push({ source: 'cognitive_load',  issue: i.issue,        severity: 'medium' });
  for (const i of (language?.issues || []))       issues.push({ source: 'language',        issue: i.issue,        severity: 'medium',                fix: i.fix });
  for (const i of (awareness?.issues || []))      issues.push({ source: 'awareness_match', issue: i.issue,        severity: i.severity || 'medium',  fix: i.fix });
  if (!trust?.sufficient)                         issues.push({ source: 'trust',           issue: 'אין מספיק אלמנטי אמון', severity: 'high', fix: `הוסף: ${trust?.missing?.slice(0,2).join(', ')}` });
  for (const i of (tracking?.issues || []))       issues.push({ source: 'tracking',        issue: i.issue,        severity: i.severity });
  for (const i of (flow?.issues || []))           issues.push({ source: 'flow',            issue: i.issue,        severity: i.severity });
  if (hookEval?.market_comparison === 'נראה כמו השוק') issues.push({ source: 'hook', issue: 'הוקים דומים לשוק — לא מספיק ייחודיים', severity: 'high' });
  if (painDiff?.pain_depth === 'shallow')         issues.push({ source: 'pain',           issue: 'כאב שטחי',     severity: 'high',                  fix: painDiff.quick_fix });
  if (!painDiff?.differentiation?.unique)         issues.push({ source: 'differentiation',issue: 'אין בידול אמיתי', severity: 'high',               fix: painDiff?.differentiation?.issue });
  if (offerPersuasion?.offer_strength === 'weak') issues.push({ source: 'offer',          issue: 'הצעה חלשה',    severity: 'high',                  fix: offerPersuasion.offer_fix });
  if (offerPersuasion?.persuasion_flow === 'broken') issues.push({ source: 'persuasion', issue: 'רצף שכנוע שבור', severity: 'critical',             fix: offerPersuasion.persuasion_fix });

  // ── New checks ─────────────────────────────────────────────────────────────
  for (const i of (frictionCheck?.issues || []))        issues.push({ source: 'friction',          issue: i.issue, severity: i.severity || 'medium', fix: i.fix });
  for (const i of (lpHierarchy?.issues || []))          issues.push({ source: 'lp_hierarchy',      issue: i.issue, severity: i.severity || 'medium', fix: i.fix });
  for (const i of (implementationCheck?.issues || []))  issues.push({ source: 'implementation',    issue: i.issue, severity: i.severity || 'high' });
  for (const i of (marketSatCheck?.issues || []))       issues.push({ source: 'market_saturation', issue: i.issue, severity: i.severity || 'high',   fix: i.fix });
  for (const i of (messageClarity?.issues || []))       issues.push({ source: 'message_clarity',   issue: i.issue, severity: i.severity || 'medium', fix: i.fix });
  if (edgeCases?.edge_case_score < 40)                  issues.push({ source: 'edge_cases',        issue: edgeCases.top_edge_issue || 'edge cases חלשים', severity: 'high', fix: edgeCases.fix });
  if (edgeCases?.intent_drift?.exists)                  issues.push({ source: 'intent_drift',      issue: edgeCases.intent_drift.description, severity: 'high', fix: edgeCases.intent_drift.fix });
  if (executionFidelity?.fidelity_score < 50)           issues.push({ source: 'execution_fidelity',issue: `ביצוע לא נאמן לאסטרטגיה (${executionFidelity.fidelity_score}/100)`, severity: 'high', fix: executionFidelity.fidelity_fix });
  if (executionFidelity?.platform_format_fit === 'wrong') issues.push({ source: 'platform_format', issue: 'פורמט לא מתאים לפלטפורמה', severity: 'critical', fix: 'שכתב לפי מגבלות הפלטפורמה' });
  if (businessAnalysis?.business_fit?.score < 50)       issues.push({ source: 'business_fit',      issue: businessAnalysis.business_fit.issue || 'חוסר התאמה עסקית', severity: 'high' });
  if (businessAnalysis?.roi_outlook === 'negative')     issues.push({ source: 'roi',               issue: 'ROI שלילי צפוי', severity: 'high', fix: businessAnalysis.roi_note });
  if (businessAnalysis?.over_optimized)                 issues.push({ source: 'over_optimization', issue: 'ייעול יתר — שובר פשטות', severity: 'medium', fix: businessAnalysis.over_optimization_fix });
  if (businessAnalysis?.fatigue_risk === 'high')        issues.push({ source: 'content_fatigue',   issue: `עייפות תוכן מהירה: "${businessAnalysis.fatigue_element}"`, severity: 'medium' });

  return issues;
}

function _quickScore(checks) {
  const scores = [
    checks.hook?.overall_hook_score        || 50,
    checks.pain?.pain_score                || 50,
    checks.differentiation?.score          || 50,
    checks.offer?.offer_score              || 50,
    checks.persuasion?.persuasion_score    || 50,
    checks.language?.score                 || 50,
    checks.awareness?.passed ? 80 : 40,
    checks.trust?.score                    || 50,
  ];
  const base = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  return Math.max(0, base - (checks.killSignals?.count || 0) * 12);
}

module.exports = { runQaPipeline };
