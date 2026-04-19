'use strict';
/**
 * qa/output/routing-engine.js
 * CRITICAL: Decides what to do with QA results.
 * If issues found → routes back to the correct agent with specific instructions.
 * Agents: execution | strategy | null (no redo needed)
 */

// Issue sources that map to execution agent
const EXECUTION_ISSUES = ['hook', 'cta', 'language', 'cognitive_load', 'differentiation', 'offer', 'persuasion', 'kill_signals', 'trust', 'ad_copy', 'lp_copy'];
// Issue sources that map to strategy agent
const STRATEGY_ISSUES  = ['awareness_mismatch', 'positioning', 'angle_strategic', 'target_audience', 'business_fit'];

function buildRoutingDecision({ verdict, allIssues, killSignals, corrections, brief, qaScores }) {
  // ── Fast path: approved ───────────────────────────────────────────────────
  if (verdict === 'approve') {
    return { should_redo: false, target_agent: null, priority: null, reason: 'הכל תקין — מוכן לשיגור', instructions: [] };
  }

  const criticalCount  = allIssues.filter(i => i.severity === 'critical').length;
  const killCount      = killSignals?.count || 0;
  const hasCritical    = criticalCount > 0 || killCount >= 2;

  // ── Determine target agent ────────────────────────────────────────────────
  const strategicIssueCount  = allIssues.filter(i => STRATEGY_ISSUES.some(s => (i.source || '').includes(s))).length;
  const executionIssueCount  = allIssues.filter(i => EXECUTION_ISSUES.some(s => (i.source || '').includes(s))).length;

  // If more strategic issues → send to strategy; otherwise execution
  const targetAgent = strategicIssueCount > executionIssueCount ? 'strategy' : 'execution';

  // ── Build re-run instructions ─────────────────────────────────────────────
  const instructions = _buildInstructions({ corrections, killSignals, allIssues, targetAgent, qaScores });

  // ── Priority level ────────────────────────────────────────────────────────
  const priority = hasCritical ? 'full_rerun' : verdict === 'reject' ? 'full_rerun' : 'targeted_fix';

  // ── Execution-specific: which assets to redo ──────────────────────────────
  const assetsToRedo = targetAgent === 'execution' ? _identifyAssetsToRedo(corrections) : [];

  return {
    should_redo:   true,
    target_agent:  targetAgent,
    priority,
    reason:        _buildReason(verdict, killCount, criticalCount, targetAgent),
    instructions,
    assets_to_redo: assetsToRedo,
    redo_context:  {
      qa_score:          qaScores?.overall || 0,
      top_issues:        allIssues.slice(0, 3).map(i => i.issue || i.description),
      corrections_count: corrections?.length || 0,
    },
  };
}

function _buildInstructions({ corrections, killSignals, allIssues, targetAgent, qaScores }) {
  const instructions = [];

  // Kill signal instructions (most critical)
  for (const sig of (killSignals?.signals || [])) {
    instructions.push({ priority: 'critical', instruction: sig.fix, source: sig.signal });
  }

  // Top corrections from AI
  const critical = (corrections || []).filter(c => c.priority === 'critical').slice(0, 3);
  for (const c of critical) {
    instructions.push({ priority: 'critical', instruction: c.fix, asset: c.asset });
  }

  const high = (corrections || []).filter(c => c.priority === 'high').slice(0, 3);
  for (const c of high) {
    instructions.push({ priority: 'high', instruction: c.fix, asset: c.asset });
  }

  // Score-based instructions
  if (qaScores?.hook < 50) {
    instructions.push({ priority: 'high', instruction: 'שכתב את כל ההוקים — ציון נמוך מ-50', asset: 'hooks' });
  }
  if (qaScores?.trust < 40) {
    instructions.push({ priority: 'high', instruction: 'הוסף לפחות 2 אלמנטי אמון (מספרים, עדות, ערבות)', asset: 'landing_page' });
  }

  return instructions;
}

function _identifyAssetsToRedo(corrections) {
  const assetSet = new Set();
  for (const c of (corrections || [])) {
    if (c.asset && c.priority !== 'low') assetSet.add(c.asset);
  }
  return [...assetSet];
}

function _buildReason(verdict, killCount, criticalCount, targetAgent) {
  if (verdict === 'reject') return `נדחה — ${killCount} kill signals + ${criticalCount} בעיות קריטיות → שולח ל${targetAgent === 'execution' ? 'סוכן ביצוע' : 'סוכן אסטרטגיה'} לשיפור`;
  if (verdict === 'improve') return `נדרש שיפור — ${criticalCount} בעיות קריטיות → שולח ל${targetAgent === 'execution' ? 'סוכן ביצוע' : 'סוכן אסטרטגיה'}`;
  return 'נדרש תיקון';
}

module.exports = { buildRoutingDecision };
