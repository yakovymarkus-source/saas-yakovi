'use strict';

/**
 * revenue-calculator.js — Offer & Revenue Architecture (Layer 14)
 *
 * Pure math. Zero DB calls. Zero side effects.
 * Answers the question: "האם ההצעה מחזיקה מספרית?"
 *
 * Inputs come from two sources:
 *   1. businessProfile — price, model, goals (stable business facts)
 *   2. liveMetrics     — CTR, CPC, convRate, spend, conversions (from analyze-service)
 *
 * All outputs include both the number AND a Hebrew verdict so the chat
 * response can display them without extra logic.
 */

const safeDivide = (a, b) => (b && b !== 0) ? a / b : null;
const round2     = (n)    => n !== null ? Math.round(n * 100) / 100 : null;
const roundInt   = (n)    => n !== null ? Math.round(n) : null;

// ── Unit Economics ────────────────────────────────────────────────────────────

/**
 * computeUnitEconomics({ businessProfile, liveMetrics, closeRate })
 *
 * @param {object} businessProfile  — from loadBusinessProfile()
 * @param {object} liveMetrics      — { spend, clicks, impressions, conversions, revenue, ctr, convRate, cpc, roas }
 * @param {number} closeRate        — fraction of leads that close as sales (default 1.0)
 *
 * @returns {UnitEconomics}
 *   {
 *     cpl, cac, ltv, roas,
 *     breakEvenCPL, sustainableCPL,
 *     cplStatus: 'profitable'|'marginal'|'losing'|null,
 *     minRoasNeeded,
 *     paybackMonths,
 *     revenuePerCustomer,
 *     margin,
 *   }
 */
function computeUnitEconomics({ businessProfile, liveMetrics, closeRate = 1.0 }) {
  const bp = businessProfile || {};
  const m  = liveMetrics     || {};

  const priceAmount   = Number(bp.price_amount)   || null;
  const pricingModel  = bp.pricing_model           || 'one_time';
  const monthlyBudget = Number(bp.monthly_budget)  || null;

  const spend       = Number(m.spend       || 0);
  const conversions = Number(m.conversions || 0);   // leads / form fills
  const revenue     = Number(m.revenue     || 0);
  const cpc         = Number(m.cpc         || 0);
  const convRate    = Number(m.convRate     || 0);

  // ── CPL (cost per lead) ───────────────────────────────────────────────────
  const cpl = conversions > 0 ? round2(spend / conversions) : null;

  // ── CAC (cost per acquired customer, after close rate) ───────────────────
  const effectiveClose = Math.min(Math.max(closeRate, 0.01), 1);
  const cac = cpl !== null ? round2(cpl / effectiveClose) : null;

  // ── Revenue per customer ──────────────────────────────────────────────────
  const revenuePerCustomer = priceAmount
    || (revenue > 0 && conversions > 0 ? round2(revenue / conversions) : null);

  // ── LTV (lifetime value) ──────────────────────────────────────────────────
  // Recurring: assume 3-month conservative retention unless price_amount covers it
  let ltv = revenuePerCustomer;
  if (pricingModel === 'recurring' && revenuePerCustomer) {
    ltv = round2(revenuePerCustomer * 3);
  }

  // ── ROAS (return on ad spend) ─────────────────────────────────────────────
  const roas = spend > 0 && revenue > 0 ? round2(revenue / spend) : null;

  // ── Break-even CPL ────────────────────────────────────────────────────────
  // Max we can pay per lead and still not lose money
  const breakEvenCPL = ltv !== null ? round2(ltv * effectiveClose) : null;

  // Sustainable CPL = break-even with 40% margin target
  const sustainableCPL = breakEvenCPL !== null ? round2(breakEvenCPL * 0.6) : null;

  // ── CPL health status ─────────────────────────────────────────────────────
  let cplStatus = null;
  if (cpl !== null && breakEvenCPL !== null) {
    if (cpl <= sustainableCPL)  cplStatus = 'profitable';
    else if (cpl <= breakEvenCPL) cplStatus = 'marginal';
    else                          cplStatus = 'losing';
  }

  // ── Minimum ROAS needed to break even ────────────────────────────────────
  // ROAS_min = 1 / (convRate) × (CPC / price)
  const minRoasNeeded = (convRate > 0 && cpc > 0 && revenuePerCustomer)
    ? round2((cpc / convRate) / revenuePerCustomer)
    : null;

  // ── Payback period (recurring only) ──────────────────────────────────────
  const paybackMonths = (pricingModel === 'recurring' && cac && revenuePerCustomer && revenuePerCustomer > 0)
    ? Math.ceil(cac / revenuePerCustomer)
    : null;

  // ── Margin (actual, if revenue data available) ────────────────────────────
  const margin = spend > 0 && revenue > 0 ? round2((revenue - spend) / revenue) : null;

  return {
    cpl,
    cac,
    ltv,
    roas,
    breakEvenCPL,
    sustainableCPL,
    cplStatus,
    minRoasNeeded,
    paybackMonths,
    revenuePerCustomer,
    margin,
  };
}

// ── Funnel Economics ──────────────────────────────────────────────────────────

/**
 * computeFunnelEconomics({ targetRevenue, businessProfile, liveMetrics })
 *
 * Works backwards from a revenue goal to determine how many leads/clicks/
 * impressions are needed, and whether the current funnel can support it.
 *
 * @returns {FunnelEconomics}
 *   {
 *     targetRevenue, revenuePerCustomer,
 *     salesNeeded, leadsNeeded, clicksNeeded, impressionsNeeded,
 *     budgetNeeded, feasible, gap,
 *   }
 */
function computeFunnelEconomics({ targetRevenue, businessProfile, liveMetrics, closeRate = 1.0 }) {
  const bp = businessProfile || {};
  const m  = liveMetrics     || {};

  const revenuePerCustomer = Number(bp.price_amount) || null;
  const convRate           = Number(m.convRate || 0);
  const ctr                = Number(m.ctr      || 0);
  const cpc                = Number(m.cpc      || 0);
  const effectiveClose     = Math.min(Math.max(closeRate, 0.01), 1);

  if (!revenuePerCustomer || !targetRevenue) {
    return { targetRevenue, revenuePerCustomer, feasible: null, gap: null };
  }

  const salesNeeded      = Math.ceil(targetRevenue / revenuePerCustomer);
  const leadsNeeded      = Math.ceil(salesNeeded / effectiveClose);
  const clicksNeeded     = convRate > 0 ? Math.ceil(leadsNeeded / convRate)  : null;
  const impressionsNeeded = (clicksNeeded && ctr > 0) ? Math.ceil(clicksNeeded / ctr) : null;
  const budgetNeeded      = (clicksNeeded && cpc > 0) ? round2(clicksNeeded * cpc)    : null;

  const monthlyBudget  = Number(bp.monthly_budget) || null;
  const feasible       = (budgetNeeded && monthlyBudget) ? budgetNeeded <= monthlyBudget : null;
  const gap            = (budgetNeeded && monthlyBudget && !feasible)
    ? round2(budgetNeeded - monthlyBudget)
    : null;

  return {
    targetRevenue,
    revenuePerCustomer,
    salesNeeded,
    leadsNeeded,
    clicksNeeded,
    impressionsNeeded,
    budgetNeeded,
    feasible,
    gap,
  };
}

// ── Launch Simulation ─────────────────────────────────────────────────────────

/**
 * simulateLaunch({ businessProfile, assumptions })
 *
 * Pre-launch simulation: given price + estimated funnel metrics, what happens?
 * Uses industry benchmarks when no live data is available.
 * Returns a risk assessment.
 *
 * @param {object} assumptions — { estimatedCTR, estimatedConvRate, dailyBudget, days, closeRate }
 */
function simulateLaunch({ businessProfile, assumptions = {} }) {
  const bp = businessProfile || {};

  const priceAmount = Number(bp.price_amount) || 0;
  const pricingModel = bp.pricing_model || 'one_time';

  // Defaults: conservative industry benchmarks
  const ctr       = Number(assumptions.estimatedCTR      || 0.015);   // 1.5%
  const convRate  = Number(assumptions.estimatedConvRate || 0.02);    // 2%
  const cpc       = Number(assumptions.estimatedCPC      || 5);       // ₪5
  const daily     = Number(assumptions.dailyBudget       || (bp.test_budget ? bp.test_budget / 7 : 50));
  const days      = Number(assumptions.days              || 7);
  const close     = Number(assumptions.closeRate         || 1.0);

  const totalSpend   = round2(daily * days);
  const clicks       = roundInt(totalSpend / cpc);
  const leads        = roundInt((clicks || 0) * convRate);
  const sales        = roundInt((leads  || 0) * close);
  const estimatedRev = round2((sales || 0) * priceAmount);
  const estimatedROAS = totalSpend > 0 ? round2(estimatedRev / totalSpend) : null;

  const breakEven    = priceAmount > 0 && leads > 0
    ? round2((totalSpend / leads) / (priceAmount * close))
    : null;

  // Risk tiers
  let riskLevel = 'medium';
  if (estimatedROAS !== null) {
    if (estimatedROAS >= 2)   riskLevel = 'low';
    if (estimatedROAS < 1)    riskLevel = 'high';
    if (estimatedROAS < 0.5)  riskLevel = 'critical';
  }

  return {
    totalSpend,
    clicks,
    leads,
    sales,
    estimatedRevenue: estimatedRev,
    estimatedROAS,
    breakEven,
    riskLevel,
    assumptions: { ctr, convRate, cpc, daily, days, close },
  };
}

// ── Hebrew verdict helpers ────────────────────────────────────────────────────

function cplStatusLabel(status) {
  return {
    profitable: '🟢 CPL רווחי',
    marginal:   '🟡 CPL גבולי',
    losing:     '🔴 CPL מפסיד',
  }[status] || '—';
}

function roasLabel(roas) {
  if (roas === null) return '—';
  if (roas >= 4)   return '🟢 מצוין';
  if (roas >= 2)   return '🟡 סביר';
  if (roas >= 1)   return '🟠 גבולי';
  return '🔴 מפסיד';
}

function riskLabel(level) {
  return {
    low:      '🟢 סיכון נמוך',
    medium:   '🟡 סיכון בינוני',
    high:     '🔴 סיכון גבוה',
    critical: '⛔ סיכון קריטי',
  }[level] || '—';
}

module.exports = {
  computeUnitEconomics,
  computeFunnelEconomics,
  simulateLaunch,
  cplStatusLabel,
  roasLabel,
  riskLabel,
};
