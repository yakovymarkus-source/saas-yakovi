'use strict';
/**
 * execution/engines/text-engine.js
 * Text Engine — orchestrates all text asset generation.
 * Pure routing: determines which AI calls to make, in what order, with what params.
 * Does NOT call AI directly (delegates to claude-execution-engine).
 */

const {
  generateHooks,
  generateAdCopy,
  generateLandingPage,
  generateScript,
  generateEmail,
  generateCTA,
} = require('../collectors/claude-execution-engine');

const { buildVariationInstructions } = require('../core/anti-repetition');

async function runTextEngine({ brief, messageCore, offer, awarenessProfile, decisionProfile, onStep }) {
  const { assetTypes, executionMode } = brief;
  const { variantStrategy } = decisionProfile;
  const results = {};

  // ── Step 1: Hooks (always first — used by all other assets) ───────────────
  if (_needsHooks(assetTypes)) {
    onStep?.('hooks_start');
    const allHooks = [];
    for (let i = 0; i < variantStrategy.length; i++) {
      const variantInstructions = buildVariationInstructions(i, variantStrategy, allHooks.map(h => h.text));
      const hookResult = await generateHooks({ brief, messageCore, awarenessProfile, decisionProfile, variantInstructions });
      allHooks.push(...(hookResult.hooks || []));
    }
    // Deduplicate
    const seen = new Set();
    results.hooks = allHooks.filter(h => {
      if (seen.has(h.text)) return false;
      seen.add(h.text);
      return true;
    }).slice(0, decisionProfile.modeParams.variantCount * 3);
    onStep?.('hooks_done', { count: results.hooks.length });
  }

  // ── Step 2: CTA variants ───────────────────────────────────────────────────
  if (assetTypes.includes('cta') || assetTypes.includes('ads') || assetTypes.includes('landing_page')) {
    onStep?.('cta_start');
    const ctaResult = await generateCTA({ brief, messageCore, offer, awarenessProfile, count: 3 });
    results.cta = ctaResult.ctas || [];
    onStep?.('cta_done');
  }

  // ── Step 3: Ads (per variant) ─────────────────────────────────────────────
  if (assetTypes.includes('ads')) {
    onStep?.('ads_start');
    const adVariants = [];
    for (let i = 0; i < variantStrategy.length; i++) {
      const variantInstructions = buildVariationInstructions(i, variantStrategy, adVariants.map(a => a.hook_used));
      const hooks = results.hooks?.slice(i, i + 1) || [];
      const ad    = await generateAdCopy({ brief, messageCore, offer, awarenessProfile, decisionProfile, hooks, variantInstructions });
      adVariants.push({ variantIndex: i, theme: variantStrategy[i]?.label, ...ad });
    }
    results.ads = adVariants;
    onStep?.('ads_done', { count: adVariants.length });
  }

  // ── Step 4: Landing Page ──────────────────────────────────────────────────
  if (assetTypes.includes('landing_page')) {
    onStep?.('lp_start');
    results.landing_page = await generateLandingPage({ brief, messageCore, offer, awarenessProfile, decisionProfile });
    onStep?.('lp_done');
  }

  // ── Step 5: Scripts ───────────────────────────────────────────────────────
  if (assetTypes.includes('scripts')) {
    onStep?.('scripts_start');
    const scriptVariants = [];
    for (let i = 0; i < variantStrategy.length; i++) {
      const script = await generateScript({ brief, messageCore, offer, awarenessProfile, decisionProfile });
      scriptVariants.push({ variantIndex: i, theme: variantStrategy[i]?.label, ...script });
    }
    results.scripts = scriptVariants;
    onStep?.('scripts_done', { count: scriptVariants.length });
  }

  // ── Step 6: Email sequence ────────────────────────────────────────────────
  if (assetTypes.includes('email')) {
    onStep?.('email_start');
    const sequenceLength = decisionProfile?.assetRouting?.email?.sequenceLength || 3;
    const emails = [];
    for (let i = 0; i < sequenceLength; i++) {
      const email = await generateEmail({ brief, messageCore, offer, awarenessProfile, decisionProfile, emailIndex: i });
      emails.push({ emailIndex: i, ...email });
    }
    results.email = emails;
    onStep?.('email_done', { count: emails.length });
  }

  return results;
}

function _needsHooks(assetTypes) {
  return (assetTypes || []).some(t => ['hooks', 'ads', 'scripts', 'landing_page'].includes(t));
}

module.exports = { runTextEngine };
