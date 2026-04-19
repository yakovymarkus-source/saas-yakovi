'use strict';

/**
 * research/budget-controller.js
 * Tracks AI calls and tokens — enforces hard stops.
 * Every AI call MUST go through spend() or the pipeline risks runaway costs.
 */

class BudgetController {
  constructor(plan) {
    this.plan      = plan;
    this.aiCalls   = 0;
    this.tokens    = 0;
    this.startTime = Date.now();
  }

  canSpend(tokensEstimate = 500) {
    if (this.aiCalls >= this.plan.maxAiCalls) return false;
    if (this.tokens + tokensEstimate > this.plan.maxTokens) return false;
    return true;
  }

  spend(tokensUsed) {
    this.aiCalls++;
    this.tokens += (tokensUsed || 0);
  }

  remaining() {
    return {
      aiCalls: this.plan.maxAiCalls - this.aiCalls,
      tokens:  this.plan.maxTokens  - this.tokens,
      budgetPct: Math.round((this.aiCalls / this.plan.maxAiCalls) * 100),
    };
  }

  isExhausted() {
    return this.aiCalls >= this.plan.maxAiCalls || this.tokens >= this.plan.maxTokens;
  }

  summary() {
    return {
      aiCallsUsed: this.aiCalls,
      tokensUsed:  this.tokens,
      elapsedMs:   Date.now() - this.startTime,
    };
  }
}

module.exports = { BudgetController };
