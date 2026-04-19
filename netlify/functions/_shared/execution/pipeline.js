'use strict';
/**
 * execution/pipeline.js
 * 18-step Execution Agent pipeline.
 * Enforced order. Steps written to DB as they complete.
 */

const { createClient } = require('@supabase/supabase-js');

const { normalizeInput }       = require('./core/input-normalizer');
const { buildMessageCore }     = require('./core/message-core');
const { buildAwarenessProfile } = require('./core/awareness-engine');
const { buildDecisionProfile } = require('./core/decision-layer');
const { buildOffer }           = require('./core/offer-builder');
const { detectConflicts }      = require('./core/conflict-detector');
const { buildAntiRepetitionGuard } = require('./core/anti-repetition');
const { checkConsistency }     = require('./core/consistency-check');
const { runTextEngine }        = require('./engines/text-engine');
const { runVisualEngine }      = require('./engines/visual-engine');
const { bundleAssets }         = require('./output/asset-bundler');
const { buildQaHandoff }       = require('./output/qa-handoff');
const { generateSelfFeedback, generateDecisionExplanation } = require('./collectors/claude-execution-engine');

// Token Guard constants
const MIN_PAIN_LENGTH   = 5;
const MIN_MESSAGE_LENGTH = 10;

function _supabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

async function runExecutionPipeline({ jobId, userId, strategyReport, assetTypes, executionMode, platform, customBrief }) {
  const db        = _supabase();
  const startMs   = Date.now();
  let   stepIndex = 0;
  let   aiCallsMade = 0;

  async function step(key, message, fn) {
    stepIndex++;
    await db.from('execution_steps').insert({ job_id: jobId, step_index: stepIndex, step_key: key, message, status: 'running' });
    try {
      const result = await fn();
      await db.from('execution_steps')
        .update({ status: 'done', data: result ? JSON.parse(JSON.stringify(result)) : null })
        .eq('job_id', jobId).eq('step_key', key);
      return result;
    } catch (err) {
      await db.from('execution_steps')
        .update({ status: 'error', data: { error: err.message } })
        .eq('job_id', jobId).eq('step_key', key);
      throw err;
    }
  }

  function onAssetStep(key, data) {
    // Lightweight step emitter for text/visual engine sub-steps
    db.from('execution_steps').insert({
      job_id: jobId, step_index: stepIndex + 0.5, step_key: key,
      message: key, status: 'done', data: data || null,
    }).catch(() => {});
  }

  // ── Step 1: Normalize & Validate Input ────────────────────────────────────
  const { brief, valid, errors, warnings: inputWarnings } = await step('normalize_input', 'מאמת ומנרמל קלט', async () => {
    return normalizeInput({ strategyReport, assetTypes, executionMode, platform, customBrief });
  });

  if (!valid) {
    await db.from('execution_jobs').update({ status: 'failed', error_message: `Input validation: ${errors.join(', ')}` }).eq('id', jobId);
    return { success: false, error: errors.join(', ') };
  }

  // ── Step 2: Token Guard ────────────────────────────────────────────────────
  await step('token_guard', 'בדיקת Token Guard', async () => {
    const issues = [];
    if ((brief.selectedPain || '').length < MIN_PAIN_LENGTH)    issues.push('כאב חלש מדי');
    if ((brief.coreMessage  || '').length < MIN_MESSAGE_LENGTH) issues.push('מסר מרכזי חלש מדי');
    if (issues.length > 0 && brief.confidence < 40) {
      throw new Error(`Token Guard: ${issues.join(', ')} — הקלט חלש מדי להרצת מנוע ביצוע`);
    }
    return { passed: true, warnings: issues };
  });

  // ── Step 3: Build Message Core ────────────────────────────────────────────
  const messageCore = await step('message_core', 'בונה מסר מרכזי והיררכיה', async () => {
    return buildMessageCore(brief);
  });

  // ── Step 4: Build Awareness Profile ──────────────────────────────────────
  const awarenessProfile = await step('awareness_profile', 'ניתוח רמת מודעות קהל', async () => {
    return buildAwarenessProfile(brief);
  });

  // ── Step 5: Build Decision Profile ───────────────────────────────────────
  const decisionProfile = await step('decision_profile', 'בניית פרופיל החלטות ביצוע', async () => {
    return buildDecisionProfile(brief, awarenessProfile);
  });

  // ── Step 6: Build Offer ───────────────────────────────────────────────────
  const offer = await step('build_offer', 'בניית מבנה ההצעה', async () => {
    return buildOffer(brief, awarenessProfile);
  });

  // ── Step 7: Detect Conflicts ──────────────────────────────────────────────
  const conflictResult = await step('detect_conflicts', 'בדיקת סתירות ומתחים', async () => {
    return detectConflicts({ brief, awarenessProfile, decisionProfile, messageCore });
  });

  if (!conflictResult.canProceed) {
    await db.from('execution_jobs').update({
      status: 'failed',
      error_message: `Conflict: ${conflictResult.conflicts.filter(c => c.severity === 'error').map(c => c.description).join('; ')}`,
    }).eq('id', jobId);
    return { success: false, error: 'conflict_detected', conflicts: conflictResult.conflicts };
  }

  // ── Step 8: Build Anti-Repetition Guard ───────────────────────────────────
  const antiRepGuard = await step('anti_repetition_guard', 'הכנת מגן נגד חזרות', async () => {
    return buildAntiRepetitionGuard([]);
  });

  // ── Step 9: Run Text Engine ────────────────────────────────────────────────
  let textAssets;
  await step('text_engine', 'מפעיל מנוע טקסט — מייצר נכסים', async () => {
    textAssets = await runTextEngine({
      brief, messageCore, offer, awarenessProfile, decisionProfile,
      onStep: onAssetStep,
    });
    aiCallsMade += _countTextAiCalls(brief, decisionProfile);
    return { assetTypes: Object.keys(textAssets), counts: _countEach(textAssets) };
  });

  // ── Step 10: Run Visual Engine ────────────────────────────────────────────
  let visualAssets;
  await step('visual_engine', 'מפעיל מנוע ויזואל — מייצר briefים', async () => {
    visualAssets = await runVisualEngine({
      brief, messageCore, awarenessProfile, decisionProfile,
      textAssets, onStep: onAssetStep,
    });
    if (!visualAssets?.skipped) aiCallsMade += _countVisualAiCalls(brief);
    return { skipped: visualAssets?.skipped || false };
  });

  // ── Step 11: Bundle Assets ────────────────────────────────────────────────
  let bundleResult;
  await step('bundle_assets', 'אורז נכסים לחבילה', async () => {
    bundleResult = bundleAssets({ textAssets, visualAssets, brief, decisionProfile, messageCore });
    return bundleResult.summary;
  });

  // ── Step 12: Consistency Check ────────────────────────────────────────────
  let consistencyResult;
  await step('consistency_check', 'בודק עקביות בין הנכסים', async () => {
    consistencyResult = checkConsistency(bundleResult.bundle, brief, messageCore);
    return { issues: consistencyResult.issues.length, status: consistencyResult.passedChecks };
  });

  // ── Step 13: Self-Feedback ────────────────────────────────────────────────
  let selfFeedback;
  await step('self_feedback', 'Quality check עצמי על הנכסים', async () => {
    if (brief.executionMode === 'draft') {
      selfFeedback = { skipped: true, approved: true };
      return selfFeedback;
    }
    selfFeedback = await generateSelfFeedback({ assets: bundleResult.bundle, brief, messageCore });
    aiCallsMade++;
    return selfFeedback;
  });

  // ── Step 14: Decision Explanation ─────────────────────────────────────────
  let decisionExplanation;
  await step('decision_explanation', 'מייצר הסבר החלטות שיווקיות', async () => {
    decisionExplanation = await generateDecisionExplanation({ brief, decisionProfile, awarenessProfile, consistencyResult });
    aiCallsMade++;
    return decisionExplanation;
  });

  // ── Step 15: Build QA Handoff ──────────────────────────────────────────────
  let qaHandoff;
  await step('qa_handoff', 'בונה חבילת מסירה ל-QA', async () => {
    qaHandoff = buildQaHandoff({
      brief, bundle: bundleResult.bundle, ranking: bundleResult.ranking,
      selfFeedback, decisionExplanation, conflictResult, consistencyResult,
      warnings: [...inputWarnings, ...(conflictResult.warnings || [])],
    });
    return { status: qaHandoff.status, flagged: qaHandoff.summary.totalFlagged };
  });

  // ── Step 16: Build Final Report ───────────────────────────────────────────
  const generationMs = Date.now() - startMs;
  const report = await step('build_report', 'בונה דוח ביצוע סופי', async () => {
    return {
      brief,
      message_core:  messageCore,
      awareness:     awarenessProfile,
      decision:      decisionProfile,
      offer,
      assets:        bundleResult.bundle,
      ranking:       bundleResult.ranking,
      branding:      bundleResult.brandingDirection,
      summary:       bundleResult.summary,
      self_feedback: selfFeedback,
      consistency:   { issues: consistencyResult.issues, status: consistencyResult.passedChecks },
      conflicts:     { warnings: conflictResult.warnings, count: conflictResult.totalIssues },
      qa_handoff:    qaHandoff,
      decision_explanation: decisionExplanation,
      ai_calls_made: aiCallsMade,
      generation_ms: generationMs,
    };
  });

  // ── Step 17: Save to DB ───────────────────────────────────────────────────
  let reportId;
  await step('save_report', 'שומר דוח ל-DB', async () => {
    const { data, error } = await db.from('execution_reports').insert({
      job_id:            jobId,
      user_id:           userId,
      strategy_report_id: strategyReport?.id || null,
      platform:          brief.platform,
      execution_mode:    brief.executionMode,
      asset_types:       brief.assetTypes,
      brief:             brief,
      message_core:      messageCore,
      assets:            bundleResult.bundle,
      ranking:           bundleResult.ranking || null,
      self_feedback:     selfFeedback || null,
      qa_handoff:        qaHandoff,
      warnings:          [...inputWarnings, ...(conflictResult.warnings || [])],
      ai_calls_made:     aiCallsMade,
      generation_ms:     generationMs,
    }).select('id').single();
    if (error) throw new Error(error.message);
    reportId = data.id;
    return { reportId };
  });

  // ── Step 18: Finalize ─────────────────────────────────────────────────────
  await step('finalize', 'מסיים ומעדכן סטטוס', async () => {
    await db.from('execution_jobs').update({
      status:        'completed',
      report_id:     reportId,
      ai_calls_used: aiCallsMade,
      generation_ms: generationMs,
      completed_at:  new Date().toISOString(),
    }).eq('id', jobId);
    return { success: true, reportId, generationMs, aiCallsMade };
  });

  return { success: true, reportId, generationMs, aiCallsMade, qaStatus: qaHandoff.status };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function _countTextAiCalls(brief, decisionProfile) {
  const types = brief.assetTypes || [];
  const variants = decisionProfile?.modeParams?.variantCount || 1;
  let count = 0;
  if (types.some(t => ['hooks','ads','scripts','landing_page'].includes(t))) count += variants; // hooks
  if (types.includes('ads'))          count += variants;
  if (types.includes('landing_page')) count += 1;
  if (types.includes('scripts'))      count += variants;
  if (types.includes('cta'))          count += 1;
  const emailSeq = decisionProfile?.assetRouting?.email?.sequenceLength || 3;
  if (types.includes('email'))        count += emailSeq;
  return count;
}

function _countVisualAiCalls(brief) {
  const types = brief.assetTypes || [];
  let count = 0;
  if (types.includes('ads'))          count += 1;
  if (types.includes('landing_page')) count += 1;
  if (types.includes('scripts'))      count += 1;
  return count;
}

function _countEach(textAssets) {
  const counts = {};
  for (const [k, v] of Object.entries(textAssets || {})) {
    counts[k] = Array.isArray(v) ? v.length : 1;
  }
  return counts;
}

module.exports = { runExecutionPipeline };
