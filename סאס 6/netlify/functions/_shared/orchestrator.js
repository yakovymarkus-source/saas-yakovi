'use strict';

/**
 * orchestrator.js — AI Provider Orchestration Layer
 *
 * Single entry point for all external AI execution.
 * Business logic calls orchestrate() — nothing else.
 *
 * What this does:
 *   1. Maps capability → prompt builder
 *   2. Builds the prompt from business context
 *   3. Routes to the correct provider via the router (capability-based, not provider-based)
 *   4. Retries once on transient errors (NETWORK_ERROR, TIMEOUT)
 *   5. Logs every request to ai_requests table (fire-and-forget)
 *   6. Returns StandardResult — never throws
 *
 * What this does NOT do:
 *   - It does not know about Hebrew templates or fallback copy
 *   - It does not make business decisions
 *   - It does not touch auth, billing, or DB state
 *
 * Usage:
 *   const { orchestrate } = require('./_shared/orchestrator');
 *   const result = await orchestrate('ad_copy', payload, { userId, requestId });
 *   if (result.ok) {
 *     const { variants } = result.content;
 *   } else {
 *     // fallback to template-based output
 *   }
 */

const { route }    = require('./providers/router');
const { CAPABILITIES } = require('./providers/contract');

// ── Prompt builders — one per capability ──────────────────────────────────────

const PROMPT_BUILDERS = {
  [CAPABILITIES.AD_COPY]:           require('./prompt-builders/ad-copy').buildAdCopyPrompt,
  [CAPABILITIES.ANALYSIS_SUMMARY]:  require('./prompt-builders/analysis').buildAnalysisPrompt,
  [CAPABILITIES.ISSUE_EXPLANATION]: require('./prompt-builders/issue-explanation').buildIssueExplanationPrompt,
  [CAPABILITIES.LANDING_PAGE]:      require('./prompt-builders/landing-page').buildLandingPagePrompt,
  [CAPABILITIES.ITERATION_ADVICE]:  require('./prompt-builders/iteration-advice').buildIterationAdvicePrompt,
  // CAMPAIGN_STRATEGY and IMAGE_GENERATION: add prompt builders when needed
};

// ── Transient errors that warrant a single retry ──────────────────────────────
const RETRYABLE_ERRORS = new Set(['NETWORK_ERROR', 'TIMEOUT', 'RATE_LIMITED']);

// ── DB logger (fire-and-forget) ───────────────────────────────────────────────

async function logAIRequest({ userId, requestId, capability, result }) {
  try {
    const { getAdminClient } = require('./supabase');
    const sb = getAdminClient();
    await sb.from('ai_requests').insert({
      user_id:           userId || null,
      request_id:        requestId || null,
      capability:        capability,
      provider:          result.provider,
      model:             result.model || null,
      prompt_tokens:     result.usage?.promptTokens || null,
      completion_tokens: result.usage?.completionTokens || null,
      latency_ms:        result.latency_ms || null,
      status:            result.ok ? 'success' : (result.error === 'TIMEOUT' ? 'timeout' : 'error'),
      error_code:        result.ok ? null : result.error,
      error_message:     result.ok ? null : result.errorMessage,
    });
  } catch (e) {
    // Logging must never crash the orchestrator
    console.warn('[orchestrator] ai_requests log failed (non-fatal):', e.message);
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * orchestrate(capability, payload, ctx)
 *
 * @param {string} capability  — one of CAPABILITIES.* constants
 * @param {object} payload     — capability-specific business context (not a prompt — raw data)
 * @param {object} ctx         — { userId?, requestId?, options? }
 *   options:  { model?, timeout? }  — passed through to adapter
 *
 * @returns {StandardResult}   — always resolves, never rejects
 */
async function orchestrate(capability, payload, ctx = {}) {
  const { userId, requestId, options = {} } = ctx;

  // 1. Find the prompt builder for this capability
  const buildPrompt = PROMPT_BUILDERS[capability];
  if (!buildPrompt) {
    const err = {
      ok:           false,
      provider:     '(none)',
      capability,
      error:        'CAPABILITY_NOT_FOUND',
      errorMessage: `No prompt builder registered for capability: "${capability}"`,
      latency_ms:   0,
    };
    console.warn('[orchestrator]', err.errorMessage);
    return err;
  }

  // 2. Build the prompt from business context
  let prompt;
  try {
    prompt = buildPrompt(payload);
  } catch (e) {
    return {
      ok:           false,
      provider:     '(none)',
      capability,
      error:        'PROMPT_BUILD_ERROR',
      errorMessage: `Prompt builder failed: ${e.message}`,
      latency_ms:   0,
    };
  }

  // 3. Execute via router — with one retry on transient failure
  let result = await route(capability, prompt, options);

  if (!result.ok && RETRYABLE_ERRORS.has(result.error)) {
    console.warn(`[orchestrator] Retrying ${capability} after ${result.error}`);
    result = await route(capability, prompt, options);
  }

  // 4. Log (fire-and-forget — must not block or throw)
  logAIRequest({ userId, requestId, capability, result }).catch(() => {});

  return result;
}

module.exports = { orchestrate, CAPABILITIES };
