'use strict';
/**
 * qa/output/qa-report-builder.js
 * Assembles the strict QA output schema.
 */

function buildQaReport({
  brief, executionReportId, researchReportId,
  checks, simulation, variantRanking,
  corrections, testPlan, routing,
  allIssues, aiCallsMade, generationMs,
}) {
  const { overall, verdict } = _calcOverall(checks, simulation);

  return {
    ok:                   true,
    agent:                'qa',
    execution_report_id:  executionReportId,
    research_report_id:   researchReportId || null,

    // ── Verdict ────────────────────────────────────────────────────────────
    verdict,          // 'approve' | 'improve' | 'reject'
    overall_score:    overall,

    // ── All check results ──────────────────────────────────────────────────
    checks: {
      hook:             checks.hook,
      pain:             checks.pain,
      differentiation:  checks.differentiation,
      offer:            checks.offer,
      persuasion:       checks.persuasion,
      language:         checks.language,
      awareness:        checks.awareness,
      cognitive_load:   checks.cognitiveLoad,
      trust:            checks.trust,
      tracking:         checks.tracking,
      kill_signals:     checks.killSignals,
      flow:             checks.flow,
    },

    // ── Simulation ─────────────────────────────────────────────────────────
    simulation,

    // ── Variants ───────────────────────────────────────────────────────────
    variants:    variantRanking?.ranking || [],
    top_winner:  variantRanking?.top_variant ?? null,

    // ── Corrections ────────────────────────────────────────────────────────
    corrections: corrections?.corrections || [],

    // ── Routing ────────────────────────────────────────────────────────────
    routing,

    // ── Test Plan ──────────────────────────────────────────────────────────
    test_plan: testPlan,

    // ── Summary ────────────────────────────────────────────────────────────
    summary: _buildSummary(checks, allIssues, corrections, brief),

    // ── Meta ───────────────────────────────────────────────────────────────
    ai_calls_made: aiCallsMade,
    generation_ms: generationMs,
  };
}

function _calcOverall(checks, simulation) {
  const scores = {
    hook:           checks.hook?.overall_hook_score        ?? 50,
    pain:           checks.pain?.pain_score                ?? 50,
    differentiation:checks.differentiation?.score          ?? 50,
    offer:          checks.offer?.offer_score              ?? 50,
    persuasion:     checks.persuasion?.persuasion_score    ?? 50,
    language:       checks.language?.score                 ?? 50,
    trust:          checks.trust?.score                    ?? 50,
    cognitive_load: checks.cognitiveLoad?.score            ?? 50,
    awareness:      checks.awareness?.passed ? 80 : 40,
  };

  const weights = { hook: 0.20, pain: 0.15, differentiation: 0.12, offer: 0.13, persuasion: 0.10, language: 0.08, trust: 0.10, cognitive_load: 0.07, awareness: 0.05 };
  let overall = 0;
  for (const [k, w] of Object.entries(weights)) overall += (scores[k] || 50) * w;
  overall = Math.round(overall);

  // Kill signal penalty
  const kills = checks.killSignals?.count || 0;
  overall = Math.max(0, overall - kills * 12);

  const verdict = overall >= 72 ? 'approve' : overall >= 45 ? 'improve' : 'reject';
  return { overall, verdict };
}

function _buildSummary(checks, allIssues, corrections, brief) {
  const criticalIssues  = (allIssues || []).filter(i => i.severity === 'critical');
  const highIssues      = (allIssues || []).filter(i => i.severity === 'high');
  const criticalFixes   = (corrections?.corrections || []).filter(c => c.priority === 'critical');

  return {
    totalChecks:    12,
    passed:         _countPassed(checks),
    failed:         _countFailed(checks),
    critical_issues: criticalIssues.length,
    high_issues:    highIssues.length,
    kill_signals:   checks.killSignals?.count || 0,
    corrections_needed: corrections?.count || 0,
    top_priority_fix:   criticalFixes[0]?.fix || null,
    platform:       brief?.platform,
    execution_mode: brief?.executionMode,
  };
}

function _countPassed(checks) {
  let count = 0;
  if ((checks.hook?.overall_hook_score || 0) >= 60) count++;
  if ((checks.pain?.pain_score || 0) >= 60) count++;
  if (checks.differentiation?.unique) count++;
  if ((checks.offer?.offer_score || 0) >= 60) count++;
  if ((checks.persuasion?.persuasion_score || 0) >= 60) count++;
  if ((checks.language?.score || 0) >= 60) count++;
  if (checks.awareness?.passed) count++;
  if (checks.trust?.sufficient) count++;
  if (checks.tracking?.ready) count++;
  if ((checks.cognitiveLoad?.score || 0) >= 60) count++;
  if (checks.flow?.passed) count++;
  if ((checks.killSignals?.count || 0) === 0) count++;
  return count;
}

function _countFailed(checks) { return 12 - _countPassed(checks); }

module.exports = { buildQaReport };
