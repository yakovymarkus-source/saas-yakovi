'use strict';
/**
 * qa/core/simulation-engine.js
 * Simulated performance prediction — formula-based (no AI).
 * Outputs: scroll_stop_probability, click_probability, conversion_probability.
 * Based on: hook score, CTA strength, trust signals, awareness match, offer value.
 */

function runSimulation({ hookScore, offerScore, trustScore, ctaScore, awarenessMatchScore, cognitiveLoadScore, platform, brief }) {
  // Normalise all inputs to 0–1
  const hook     = _norm(hookScore,     0, 100);
  const offer    = _norm(offerScore,    0, 100);
  const trust    = _norm(trustScore,    0, 100);
  const cta      = _norm(ctaScore,      0, 100);
  const awareness= _norm(awarenessMatchScore, 0, 100);
  const clarity  = _norm(cognitiveLoadScore,  0, 100);

  // ── scroll_stop_probability ───────────────────────────────────────────────
  // Driven mostly by hook quality + platform behavior
  const platformHookMultiplier = _platformHookBonus(platform);
  const scroll_stop = _clamp(
    (hook * 0.60 + clarity * 0.25 + offer * 0.15) * platformHookMultiplier,
    0.05, 0.95
  );

  // ── click_probability ─────────────────────────────────────────────────────
  // Driven by CTA + offer + awareness match
  const click = _clamp(
    scroll_stop * (cta * 0.45 + offer * 0.35 + awareness * 0.20),
    0.02, 0.70
  );

  // ── conversion_probability ─────────────────────────────────────────────────
  // Driven by trust + offer value + clarity + CTA
  const conversion = _clamp(
    click * (trust * 0.40 + offer * 0.35 + clarity * 0.15 + cta * 0.10),
    0.01, 0.45
  );

  const label = _label(scroll_stop, click, conversion);

  // ROI estimate
  const roiEstimate = _estimateRoi(conversion, platform, (brief || {}).priceTier);

  return {
    scroll_stop_probability:  _pct(scroll_stop),
    click_probability:        _pct(click),
    conversion_probability:   _pct(conversion),
    label,
    roi_estimate:             roiEstimate,
    micro_conversions: {
      scroll_depth:     _pct(_clamp(scroll_stop * 1.3, 0.1, 0.95)),
      time_on_page:     scroll_stop >= 0.5 ? 'high' : scroll_stop >= 0.3 ? 'medium' : 'low',
      cta_hover_chance: _pct(_clamp(click * 1.4, 0.05, 0.80)),
    },
    breakdown: {
      hook_quality:       _pct(hook),
      offer_strength:     _pct(offer),
      trust_level:        _pct(trust),
      cta_effectiveness:  _pct(cta),
      awareness_fit:      _pct(awareness),
      clarity_score:      _pct(clarity),
    },
  };
}

function _estimateRoi(conversionRate, platform, priceTier) {
  // Avg CPC by platform (USD estimate)
  const cpc = { meta: 1.2, instagram: 1.5, tiktok: 0.8, google: 2.5, youtube: 0.5, linkedin: 5.0, email: 0.1 };
  const avgCpc = cpc[platform] || 1.2;

  // Price tier multiplier for revenue per conversion
  const revenueMap = { high: 500, medium: 150, low: 50 };
  const revenue = revenueMap[priceTier] || 150;

  // At 1000 clicks:
  const clicks1k = 1000;
  const cost1k   = Math.round(clicks1k * avgCpc);
  const leads1k  = Math.round(clicks1k * conversionRate);
  const revenue1k= Math.round(leads1k * revenue * 0.1); // assume 10% close rate
  const roas     = cost1k > 0 ? Math.round((revenue1k / cost1k) * 10) / 10 : 0;

  return {
    estimated_cpc:       `$${avgCpc}`,
    leads_per_1k_clicks: leads1k,
    estimated_revenue_1k: `$${revenue1k}`,
    estimated_roas:      roas,
    roi_verdict:         roas >= 2 ? 'positive' : roas >= 1 ? 'break_even' : 'negative',
    note:               'הערכה בלבד — מבוסס על ממוצעי שוק, לא מדד בפועל',
  };
}

function _label(scroll, click, conv) {
  const avg = (scroll + click + conv * 3) / 5; // weight conversion more
  if (avg >= 0.55) return 'strong';
  if (avg >= 0.35) return 'moderate';
  if (avg >= 0.20) return 'weak';
  return 'critical';
}

function _platformHookBonus(platform) {
  // TikTok/Instagram: first-frame is everything → higher multiplier
  const bonuses = { tiktok: 1.15, instagram: 1.10, meta: 1.05, youtube: 1.00, google: 0.90, linkedin: 0.95, email: 0.85 };
  return bonuses[platform] || 1.0;
}

function _norm(val, min, max) {
  if (val === null || val === undefined) return 0.5;
  return Math.max(0, Math.min(1, (val - min) / (max - min)));
}

function _clamp(val, min, max) { return Math.max(min, Math.min(max, val)); }
function _pct(val) { return Math.round(val * 100) / 100; }

module.exports = { runSimulation };
