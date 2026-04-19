'use strict';
/**
 * strategy/pipeline.js — Strategy Agent Orchestrator
 *
 * 20 modules per protocol:
 *   Translation → Product → Positioning → Revenue System →
 *   Testing → Metrics → Validation → Trade-offs → Coherence →
 *   Scalability → Risk → Reality Check → Decision → Output
 *
 * Reuses:
 *   - iteration-engine.js (VARIATION_MODES) via revenue-system.js
 *   - learning-engine.js  (persistStrategyMemory) for post-pipeline persistence
 *   - research/shared/utils.js (withRetry)
 */

require('../env');
const { withRetry }         = require('../research/shared/utils');
const { translateResearch } = require('./engines/translation-layer');
const { runProductEngine }  = require('./engines/product-engine');
const { runPositioningEngine, scorePositioning } = require('./engines/positioning-engine');
const { runRevenueSystemEngine } = require('./engines/revenue-system');
const { buildTestPlanSkeleton }  = require('./engines/testing-engine');
const { buildMetrics }          = require('./engines/metrics-engine');
const { runValidation, checkCoherence, checkSystemFit } = require('./engines/validation-layer');
const {
  evaluateTradeoffs, checkScalability, assessRisks,
  buildRealityCheckContext, makeDecision, checkStopConditions,
} = require('./engines/decision-layer');
const {
  designProduct, generatePositioning, buildCoreMessage,
  buildFunnelArchitecture, buildTestPlan, runRealityCheck,
} = require('./collectors/claude-strategy-engine');
const { buildStrategyReport }     = require('./output/strategy-builder');
const { persistStrategyMemory }   = require('../learning-engine');

// ── API key helper (same pattern as research pipeline) ─────────────────────────
function getAnthropicKey() {
  let key = process.env.ANTHROPIC_API_KEY || '';
  try {
    const fs = require('node:fs'), path = require('node:path');
    const f  = path.resolve(__dirname, '../../../..', '.env');
    if (fs.existsSync(f)) {
      for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
        const m = line.match(/^ANTHROPIC_API_KEY=(.+)/);
        if (m) { key = m[1].trim(); break; }
      }
    }
  } catch {}
  return key;
}

// ── Main pipeline ──────────────────────────────────────────────────────────────
async function runStrategyPipeline({ job, researchReport, supabase, onStep }) {
  const startTime = Date.now();
  const apiKey    = getAnthropicKey();
  const model     = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
  let aiCallsMade = 0;

  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  // ── Emitter ────────────────────────────────────────────────────────────────
  let stepIdx = 0;
  async function emit(key, message, status = 'running', data = null) {
    stepIdx++;
    try {
      await supabase.from('strategy_steps').insert({
        job_id: job.id, step_index: stepIdx, step_key: key, message, status, data: data ?? undefined,
      });
    } catch (e) { console.warn('[strategy-pipeline] emit failed:', e.message); }
    if (onStep) onStep({ step_index: stepIdx, step_key: key, message, status });
  }

  async function updateJob(patch) {
    await supabase.from('strategy_jobs').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', job.id);
  }

  async function logUsage(operation, tokens = 1500, success = true) {
    aiCallsMade++;
    try {
      await supabase.from('research_usage_logs').insert({
        job_id: job.id, user_id: job.user_id,
        action: `strategy:${operation}`, provider: 'claude_researcher',
        tokens_used: tokens, success,
      });
    } catch {}
  }

  // ── System State ───────────────────────────────────────────────────────────
  const systemState = {
    phase: 'init',
    iterationCount: 0,
    maxIterations: 2,
    currentPainIndex: 0,
  };

  // Pipeline state
  let translated, productResult, positioningResult, revenueSystem;
  let testPlan, metrics, validation, tradeoffs, coherence, scalability, systemFit, risks, realityCheck, decision;

  // ── Avatar shape adapter ───────────────────────────────────────────────────
  // Research report stores flat arrays (core_pains, fears…); translation-layer
  // expects grouped signal objects ({ text, type, frequency, confidence }).
  function _adaptAvatar(avatar) {
    if (!avatar) return null;
    if (avatar.groups) return avatar; // already in expected format
    const toSigs = (arr, type) => (arr || []).map(t => ({
      text:       typeof t === 'string' ? t : (t.text || String(t)),
      type,
      frequency:  1,
      confidence: 70,
    }));
    return {
      groups: {
        pain:        toSigs(avatar.core_pains,  'pain'),
        frustration: toSigs(avatar.frustrations,'frustration'),
        fear:        toSigs(avatar.fears,        'fear'),
        desire:      toSigs(avatar.desires,      'desire'),
      },
      languagePatterns: avatar.language_patterns || [],
      segments:         avatar.segments          || [],
      totalSignals:     avatar.total_signals     || 0,
      qualityScore:     avatar.quality_score     || 50,
    };
  }

  try {
    await updateJob({ status: 'running', started_at: new Date().toISOString() });

    // ── MODULE 1: Translation Layer ──────────────────────────────────────────
    systemState.phase = 'translation';
    await emit('translation', 'ממיר נתוני מחקר להחלטות אסטרטגיות...');
    translated = translateResearch({
      avatar_signals: _adaptAvatar(researchReport.avatar),
      competitors:    researchReport.market_map?.top_competitors || researchReport.market_map?.competitors || [],
      gaps:           researchReport.insights?.gaps     || [],
      patterns:       researchReport.insights?.patterns || [],
    });
    await emit('translation_done', `זוהו ${translated.painCandidates.length} כאבים, ${translated.competitorMessages.length} מתחרים, ${translated.opportunityZones.length} הזדמנויות`, 'done');

    // ── MODULE 2: Product Engine ─────────────────────────────────────────────
    systemState.phase = 'product';
    await emit('product_scoring', 'מדרג כאבים לפי עוצמה, תדירות וסיגנל מוניטיזציה...');
    productResult = runProductEngine({
      painCandidates:    translated.painCandidates,
      competitorMessages: translated.competitorMessages,
      opportunityZones:  translated.opportunityZones,
    });

    if (!productResult.selectedPain) {
      await emit('product_fail', '❌ לא נמצא כאב מספיק חזק — לא ניתן לבנות מוצר', 'error');
      throw new Error('NO_PAIN_FOUND: לא נמצא כאב עם ציון מספיק גבוה');
    }

    await emit('product_selected', `כאב נבחר: "${productResult.selectedPain}" (ציון: ${productResult.selectedPainScore}/100)`, 'done');

    // AI: Design product — outcome + structure
    await emit('product_design', `מתכנן מוצר מסוג "${productResult.productType}"...`);
    try {
      const designed = await withRetry(async () =>
        designProduct({
          apiKey, model,
          selectedPain:        productResult.selectedPain,
          backupPains:         productResult.backupPains,
          competitorMessages:  translated.competitorMessages,
          gaps:                translated.opportunityZones,
          niche:               job.niche,
          heuristicProductType: productResult.productType,
        }), 2, 1500);
      await logUsage('design_product', 1500);

      productResult.outcome              = designed.outcome;
      productResult.productType          = designed.product_type     || productResult.productType;
      productResult.productNameSuggestion= designed.product_name_suggestion;
      productResult.productStructure     = designed.product_structure || [];
      productResult.timeToResult         = designed.time_to_result;
      productResult.complexity           = designed.complexity;
      productResult.viabilityScore       = Math.max(productResult.viabilityScore, designed.viability_enriched || 0);
      productResult.viabilityReasoning   = designed.viability_reasoning;

      await emit('product_design_done', `מוצר: ${productResult.productType} — "${productResult.outcome}"`, 'done');
    } catch (e) {
      await logUsage('design_product', 0, false);
      await emit('product_design', `⚠️ עיצוב מוצר AI נכשל (${e.message}) — ממשיך עם נתונים חלקיים`, 'done');
    }

    // Viability check
    if (productResult.viabilityScore < 30) {
      await emit('viability_warn', `⚠️ ציון כדאיות נמוך (${productResult.viabilityScore}/100) — שקול כאב גיבוי`, 'done');
    }

    // ── MODULE 3: Positioning Engine ─────────────────────────────────────────
    systemState.phase = 'positioning';
    await emit('positioning_map', 'ממפה מסרים ומיצוב של מתחרים...');
    positioningResult = runPositioningEngine({
      competitorMessages: translated.competitorMessages,
      opportunityZones:   translated.opportunityZones,
      wornOutMessages:    translated.wornOutMessages,
    });
    await emit('positioning_gaps', `${translated.wornOutMessages.length} מסרים שחוקים | ${positioningResult.openAngles.length} זוויות פתוחות`, 'done');

    // AI: Generate positioning options
    await emit('positioning_generate', 'מייצר אפשרויות בידול מהפערים בשוק...');
    try {
      const posData = await withRetry(async () =>
        generatePositioning({
          apiKey, model,
          competitorMessages: translated.competitorMessages,
          gaps:               translated.opportunityZones,
          niche:              job.niche,
          selectedPain:       productResult.selectedPain,
          wornOutMessages:    translated.wornOutMessages,
        }), 2, 1500);
      await logUsage('generate_positioning', 1500);

      positioningResult.positioningOptions = posData.options || [];
      const selected = posData.options?.[posData.selected_index ?? 0] || posData.options?.[0];
      if (selected) {
        positioningResult.selectedPositioning = selected.positioning;
        positioningResult.angleType           = selected.angle_type;
        positioningResult.whySelected         = posData.why_selected;
        positioningResult.gapUsed             = selected.gap_used;
        positioningResult.positionScore       = scorePositioning(selected);
      }
      await emit('positioning_selected', `בידול נבחר: "${positioningResult.selectedPositioning}" (ציון: ${positioningResult.positionScore}/100)`, 'done');
    } catch (e) {
      await logUsage('generate_positioning', 0, false);
      await emit('positioning_generate', `⚠️ יצירת בידול AI נכשלה: ${e.message}`, 'done');
    }

    // ── MODULE 4: Revenue System Engine ─────────────────────────────────────
    systemState.phase = 'revenue';
    const painType = translated.painCandidates[0]?.type || 'pain';
    revenueSystem = runRevenueSystemEngine({
      selectedPain:       productResult.selectedPain,
      painType,
      painScore:          productResult.selectedPainScore,
      competitorMessages: translated.competitorMessages,
      productType:        productResult.productType,
      segments:           translated.segments,
      opportunityZones:   translated.opportunityZones,
    });
    await emit('revenue_method', `שיטת שיווק: ${revenueSystem.method.primary.label} | טון: ${revenueSystem.tone.label} | פלטפורמה: ${revenueSystem.platforms.primary}`, 'done');

    // AI: Core Message + Angles
    await emit('revenue_message', 'בונה מסר ליבה וזוויות שיווק...');
    try {
      const msgData = await withRetry(async () =>
        buildCoreMessage({
          apiKey, model,
          product:          productResult,
          positioning:      positioningResult,
          fearSignals:      translated.fearSignals,
          desireSignals:    translated.desireSignals,
          languagePatterns: translated.languagePatterns,
          niche:            job.niche,
        }), 2, 1500);
      await logUsage('build_core_message', 1500);

      revenueSystem.coreMessage    = msgData.core_message;
      revenueSystem.targetCustomer = msgData.target_customer;
      revenueSystem.angles         = msgData.angles || [];
      await emit('revenue_message_done', `מסר: "${revenueSystem.coreMessage}"`, 'done');
      if (revenueSystem.angles.length > 0) {
        await emit('revenue_angles', `${revenueSystem.angles.length} זוויות: ${revenueSystem.angles.slice(0, 2).map(a => a.hook || a.text).join(' | ')}`, 'done');
      }
    } catch (e) {
      await logUsage('build_core_message', 0, false);
      await emit('revenue_message', `⚠️ מסר ליבה AI נכשל: ${e.message}`, 'done');
    }

    // AI: Funnel Architecture
    await emit('revenue_funnel', 'מתכנן מבנה משפך שיווקי מלא...');
    try {
      const funnelData = await withRetry(async () =>
        buildFunnelArchitecture({
          apiKey, model,
          product:     productResult,
          positioning: positioningResult,
          method:      revenueSystem.method,
          platform:    revenueSystem.platforms,
          coreMessage: revenueSystem.coreMessage || productResult.outcome,
          niche:       job.niche,
        }), 2, 1500);
      await logUsage('build_funnel', 1500);

      revenueSystem.funnel = { ...revenueSystem.funnel, ...funnelData };
      await emit('revenue_funnel_done', `משפך: ${funnelData.traffic_source} → Hook: "${funnelData.hook_strategy}"`, 'done');
    } catch (e) {
      await logUsage('build_funnel', 0, false);
      await emit('revenue_funnel', `⚠️ בניית משפך AI נכשלה: ${e.message}`, 'done');
    }

    // ── MODULE 5: Testing Engine ─────────────────────────────────────────────
    systemState.phase = 'testing';
    await emit('testing', 'מייצר תכנית בדיקות A/B...');
    testPlan = buildTestPlanSkeleton({
      backupPains:        productResult.backupPains,
      positioningOptions: positioningResult.positioningOptions,
      angles:             revenueSystem.angles,
    });
    try {
      const tpData = await withRetry(async () =>
        buildTestPlan({
          apiKey, model,
          product:     productResult,
          positioning: positioningResult,
          coreMessage: revenueSystem.coreMessage,
          angles:      revenueSystem.angles,
          niche:       job.niche,
        }), 2, 1000);
      await logUsage('build_test_plan', 1000);
      testPlan = { ...testPlan, ...tpData };
      await emit('testing_done', `${testPlan.hypotheses?.length || 0} היפותזות בדיקה מוכנות`, 'done');
    } catch (e) {
      await logUsage('build_test_plan', 0, false);
      await emit('testing', 'דילוג על תכנית בדיקות AI', 'skipped');
    }

    // ── MODULE 6: Metrics Engine ─────────────────────────────────────────────
    await emit('metrics', 'מגדיר מדדי הצלחה לכל שלב במשפך...');
    metrics = buildMetrics({ productType: productResult.productType, platforms: revenueSystem.platforms });
    await emit('metrics_done', `מדדים: CPL < ${metrics.action.kpi} | CAC < ${metrics.payment.kpi}`, 'done');

    // ── MODULE 7: Validation Layer ───────────────────────────────────────────
    systemState.phase = 'validation';
    await emit('validation', 'מבצע בדיקות Validation (6 בדיקות)...');
    validation = runValidation({
      product:     productResult,
      positioning: positioningResult,
      strategy:    revenueSystem,
      testPlan,
      metrics,
    });
    await emit('validation_done',
      validation.status === 'PASS'
        ? `✅ Validation עבר ${validation.passed}/${validation.total} בדיקות`
        : `❌ Validation נכשל: ${validation.criticalFails.join(', ')}`,
      'done');

    // ── MODULE 8: Trade-off Engine ───────────────────────────────────────────
    tradeoffs = evaluateTradeoffs({
      product:         productResult,
      positioning:     positioningResult,
      competitorCount: translated.competitorMessages.length,
    });
    if (tradeoffs.length > 0) {
      await emit('tradeoffs', `החלטות trade-off: ${tradeoffs.map(t => t.dimension).join(' | ')}`, 'done');
    }

    // ── MODULE 9: Coherence Check ────────────────────────────────────────────
    coherence = checkCoherence({ method: revenueSystem.method, tone: revenueSystem.tone, platforms: revenueSystem.platforms, productType: productResult.productType });
    if (coherence.issues.length > 0) {
      await emit('coherence_warn', `⚠️ ${coherence.issues[0].description}`, 'done');
    }

    // ── MODULE 10: Scalability Check ─────────────────────────────────────────
    scalability = checkScalability({ productType: productResult.productType, strategy: revenueSystem });

    // ── MODULE 13 (Protocol): System Fit Check ───────────────────────────────
    systemFit = checkSystemFit({ productType: productResult.productType, platforms: revenueSystem.platforms, assets: revenueSystem.assets });
    if (!systemFit.isSystemFit) {
      await emit('system_fit_warn', `⚠️ System Fit: ${systemFit.score}% — מוצר עלול לא להתאים למשאבים הנוכחיים`, 'done');
    }

    // ── MODULE 11: Risk Assessment ───────────────────────────────────────────
    risks = assessRisks({
      product: productResult, positioning: positioningResult,
      competitorCount: translated.competitorMessages.length,
      viabilityScore:  productResult.viabilityScore,
    });
    if (risks.filter(r => r.severity === 'high').length > 0) {
      await emit('risks', `🚩 ${risks.filter(r => r.severity === 'high').length} סיכונים קריטיים: ${risks.filter(r => r.severity === 'high').map(r => r.description).join(' | ')}`, 'done');
    }

    // ── MODULE 12: Reality Check ─────────────────────────────────────────────
    systemState.phase = 'reality_check';
    await emit('reality_check', '🔍 Reality Check: האם בן אדם ישלם על זה עכשיו?');
    try {
      realityCheck = await withRetry(async () =>
        runRealityCheck({
          apiKey, model,
          product:     productResult,
          positioning: positioningResult,
          coreMessage: revenueSystem.coreMessage || productResult.outcome || '',
          niche:       job.niche,
        }), 2, 1000);
      await logUsage('reality_check', 800);
      const signal = realityCheck.go_signal === 'ירוק' ? '✅' : realityCheck.go_signal === 'צהוב' ? '⚠️' : '🔴';
      await emit('reality_check_done', `${signal} ${realityCheck.go_signal}: ${realityCheck.reason}`, 'done');

      // Protocol: if go_signal = אדום → add critical risk
      if (realityCheck.go_signal === 'אדום') {
        risks.push({
          type: 'reality_check_fail',
          description: `Reality Check נכשל: ${realityCheck.reason || 'מישהו לא ישלם על זה עכשיו'}`,
          severity: 'high',
        });
        await emit('reality_check_fail', `🔴 Reality Check: אות אדום — הוסף לסיכונים קריטיים`, 'done');
      }
      // Protocol: if must_fix present → log as warning
      if (realityCheck.must_fix) {
        await emit('reality_check_action', `🔧 חובה לתקן: ${realityCheck.must_fix}`, 'done');
      }
    } catch (e) {
      await logUsage('reality_check', 0, false);
      realityCheck = { will_someone_pay: null, go_signal: 'צהוב', reason: 'לא הושלם', confidence: 50 };
      await emit('reality_check', 'דילוג על Reality Check AI', 'skipped');
    }

    // ── MODULE 13: Decision Layer + Iteration ───────────────────────────────
    systemState.phase = 'decision';
    decision = makeDecision({ product: productResult, positioning: positioningResult, strategy: revenueSystem, validation, risks });
    await emit('decision', `החלטה: ${decision.decision} | ביטחון: ${decision.confidence}%`, 'done');

    // Protocol: Iteration Engine — if RETRY and backup pain available, try next pain
    if (decision.decision === 'RETRY' && systemState.iterationCount < systemState.maxIterations && productResult.backupPains?.length > 0) {
      systemState.iterationCount++;
      const nextPain = productResult.backupPains[systemState.iterationCount - 1];
      await emit('iteration', `🔁 Iteration ${systemState.iterationCount}: מנסה כאב גיבוי "${nextPain}"...`, 'running');

      // Override pain and rerun product + positioning engines
      const backupCandidate = translated.painCandidates.find(p => p.text === nextPain) || { text: nextPain, type: 'pain', frequency: 1, confidence: 60, painScore: 50 };
      productResult.selectedPain      = backupCandidate.text;
      productResult.selectedPainScore = backupCandidate.painScore || 50;
      productResult.backupPains        = productResult.backupPains.filter(p => p !== nextPain);

      // Re-run revenue system with new pain
      const painType2 = backupCandidate.type || 'pain';
      revenueSystem = runRevenueSystemEngine({
        selectedPain: productResult.selectedPain, painType: painType2,
        painScore: productResult.selectedPainScore,
        competitorMessages: translated.competitorMessages,
        productType: productResult.productType,
        segments: translated.segments, opportunityZones: translated.opportunityZones,
      });
      // Re-validate after iteration
      validation = runValidation({ product: productResult, positioning: positioningResult, strategy: revenueSystem, testPlan, metrics });
      risks = assessRisks({ product: productResult, positioning: positioningResult, competitorCount: translated.competitorMessages.length, viabilityScore: productResult.viabilityScore });
      decision = makeDecision({ product: productResult, positioning: positioningResult, strategy: revenueSystem, validation, risks });
      await emit('iteration_done', `✅ איטרציה הושלמה | החלטה: ${decision.decision} | ביטחון: ${decision.confidence}%`, 'done');
    }

    // ── Build Final Report ───────────────────────────────────────────────────
    systemState.phase = 'report';
    await emit('report', 'מרכיב דוח אסטרטגיה סופי...');
    const generationMs = Date.now() - startTime;

    const report = buildStrategyReport({
      jobId: job.id, userId: job.user_id, researchReportId: job.research_report_id, niche: job.niche,
      product: productResult, positioning: positioningResult, revenueSystem,
      testPlan, metrics, risks, validation, decision, coherence, scalability, systemFit, realityCheck,
      aiCallsMade, generationMs,
    });

    // Save to DB
    const { data: savedReport } = await supabase.from('strategy_reports').insert({
      job_id:             job.id,
      user_id:            job.user_id,
      research_report_id: job.research_report_id,
      niche:              job.niche,
      product:            report.product,
      positioning:        report.positioning,
      strategy:           report.strategy,
      test_plan:          report.test_plan,
      metrics:            report.metrics,
      risks:              report.risks,
      fallback_options:   report.fallback_options,
      confidence:         report.confidence,
      go_signal:          report.go_signal,
      preflight_passed:   report.preflight?.ready || false,
      validation_passed:  validation.canProceed,
      ai_calls_made:      aiCallsMade,
      generation_ms:      generationMs,
    }).select().single();

    await updateJob({
      status:        'completed',
      completed_at:  new Date().toISOString(),
      ai_calls_used: aiCallsMade,
      report_id:     savedReport?.id,
      credits_used:  1,
      generation_ms: generationMs,
    });

    // ── MODULE 10 (Protocol): Learning Engine — persist what worked ──────────
    try {
      await persistStrategyMemory(job.user_id, null, {
        niche:       job.niche,
        selectedPain: productResult.selectedPain,
        productType:  productResult.productType,
        positioning:  positioningResult.selectedPositioning,
        method:       revenueSystem.method?.primary?.method,
        platform:     revenueSystem.platforms?.primary,
        confidence:   decision.confidence,
        goSignal:     report.go_signal,
        iterationCount: systemState.iterationCount,
      }, null);
    } catch (e) { console.warn('[strategy-pipeline] learning-engine persist failed:', e.message); }

    const goEmoji = report.go_signal === 'ירוק' ? '🟢' : report.go_signal === 'צהוב' ? '🟡' : '🔴';
    await emit('done',
      `${goEmoji} אסטרטגיה הושלמה! מוצר: ${productResult.productType} | בידול: "${positioningResult.selectedPositioning || 'N/A'}" | ביטחון: ${report.confidence}%`,
      'done', { report_id: savedReport?.id, go_signal: report.go_signal });

    return { success: true, reportId: savedReport?.id, report };

  } catch (err) {
    console.error('[strategy-pipeline] fatal:', err.message);
    await updateJob({ status: 'failed', error_message: err.message });
    await emit('error', `❌ שגיאה: ${err.message}`, 'error');
    throw err;
  }
}

module.exports = { runStrategyPipeline };
