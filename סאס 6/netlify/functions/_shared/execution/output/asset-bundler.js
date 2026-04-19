'use strict';
/**
 * execution/output/asset-bundler.js
 * Bundles all generated assets into the Output Contract.
 * Groups by type and funnel stage.
 * Adds ranking for smart/premium modes.
 */

const { checkWithinBatch } = require('../core/anti-repetition');

const FUNNEL_STAGES = {
  hooks:        'top_of_funnel',
  ads:          'top_of_funnel',
  scripts:      'top_of_funnel',
  landing_page: 'middle_of_funnel',
  email:        'middle_of_funnel',
  cta:          'conversion',
};

function bundleAssets({ textAssets, visualAssets, brief, decisionProfile, messageCore }) {
  const { executionMode, assetTypes } = brief;
  const withRanking = decisionProfile?.modeParams?.withRanking || false;

  const bundle = {
    ads:          [],
    landing_page: null,
    hooks:        [],
    cta:          [],
    scripts:      [],
    email:        [],
  };

  // ── Ads ───────────────────────────────────────────────────────────────────
  if (textAssets?.ads) {
    bundle.ads = textAssets.ads.map((ad, i) => ({
      id:           `ad_${i}`,
      variantIndex: i,
      theme:        ad.theme || `וריאנט ${i + 1}`,
      text:         ad,
      visual:       visualAssets?.ads?.[i] || null,
      funnelStage:  FUNNEL_STAGES.ads,
      score:        withRanking ? _scoreAd(ad, brief, messageCore) : null,
    }));

    // Check for repetition within ads batch
    const repCheck = checkWithinBatch(bundle.ads.map(a => a.text));
    if (!repCheck.clean) bundle._adRepetitionWarnings = repCheck.issues;
  }

  // ── Landing Page ──────────────────────────────────────────────────────────
  if (textAssets?.landing_page) {
    bundle.landing_page = {
      id:          'lp_1',
      content:     textAssets.landing_page,
      visual:      visualAssets?.landing_page || null,
      funnelStage: FUNNEL_STAGES.landing_page,
      trackingEvents: textAssets.landing_page?.tracking_events || [],
    };
  }

  // ── Hooks ─────────────────────────────────────────────────────────────────
  if (textAssets?.hooks) {
    bundle.hooks = textAssets.hooks.map((h, i) => ({
      id:    `hook_${i}`,
      text:  typeof h === 'string' ? h : h.text,
      type:  h.type || 'general',
      approach: h.approach || '',
      funnelStage: FUNNEL_STAGES.hooks,
      score: withRanking ? _scoreHook(h, brief) : null,
    }));
  }

  // ── CTA ───────────────────────────────────────────────────────────────────
  if (textAssets?.cta) {
    bundle.cta = textAssets.cta.map((c, i) => ({
      id:    `cta_${i}`,
      text:  c.text || c,
      style: c.style || 'medium',
      char_count: c.character_count || (c.text || '').length,
      funnelStage: FUNNEL_STAGES.cta,
    }));
  }

  // ── Scripts ───────────────────────────────────────────────────────────────
  if (textAssets?.scripts) {
    bundle.scripts = textAssets.scripts.map((s, i) => ({
      id:          `script_${i}`,
      variantIndex: i,
      content:     s,
      visual:      visualAssets?.scripts?.[i] || null,
      funnelStage: FUNNEL_STAGES.scripts,
    }));
  }

  // ── Email ─────────────────────────────────────────────────────────────────
  if (textAssets?.email) {
    bundle.email = textAssets.email.map((e, i) => ({
      id:          `email_${i + 1}`,
      emailIndex:  i,
      content:     e,
      funnelStage: FUNNEL_STAGES.email,
    }));
  }

  // ── Ranking (smart / premium) ──────────────────────────────────────────────
  let ranking = null;
  if (withRanking) {
    ranking = _buildRanking(bundle, brief);
  }

  // ── Branding direction ────────────────────────────────────────────────────
  const brandingDirection = visualAssets?.brandingDirection || null;

  // ── Summary stats ─────────────────────────────────────────────────────────
  const summary = {
    totalAssets:   _countAssets(bundle),
    assetTypes:    assetTypes,
    executionMode,
    variantCount:  decisionProfile?.modeParams?.variantCount || 1,
    funnelCoverage: _computeFunnelCoverage(bundle),
  };

  return { bundle, ranking, brandingDirection, summary };
}

// ── Scoring helpers ───────────────────────────────────────────────────────────

function _scoreAd(ad, brief, messageCore) {
  let score = 50;
  const text = [ad.headline, ad.primary_text, ad.description].join(' ').toLowerCase();
  const painKw = (brief.selectedPain || '').toLowerCase().split(' ')[0];
  if (painKw && text.includes(painKw)) score += 15;
  if (ad.headline && ad.headline.length >= 10) score += 10;
  if (ad.cta_button) score += 10;
  const charCount = ad.character_count || (ad.primary_text || '').length;
  if (charCount > 50 && charCount < 150) score += 10;
  if (ad.hook_used) score += 5;
  return Math.min(100, score);
}

function _scoreHook(hook, brief) {
  let score = 50;
  const text = (hook.text || hook || '').toLowerCase();
  if (text.length >= 10 && text.length <= 100) score += 20;
  const painKw = (brief.selectedPain || '').toLowerCase().split(' ')[0];
  if (painKw && text.includes(painKw)) score += 20;
  if (hook.type && hook.type !== 'general') score += 10;
  return Math.min(100, score);
}

function _buildRanking(bundle, brief) {
  const ranked = [];

  for (const ad of bundle.ads) {
    if (ad.score != null) ranked.push({ id: ad.id, type: 'ad', score: ad.score, theme: ad.theme });
  }
  for (const hook of bundle.hooks) {
    if (hook.score != null) ranked.push({ id: hook.id, type: 'hook', score: hook.score });
  }

  ranked.sort((a, b) => b.score - a.score);

  return {
    topAd:   ranked.filter(r => r.type === 'ad')[0]   || null,
    topHook: ranked.filter(r => r.type === 'hook')[0] || null,
    all:     ranked,
    recommendation: ranked[0]
      ? `התחל עם ${ranked[0].type === 'ad' ? 'מודעה' : 'hook'} "${ranked[0].id}" — ציון ${ranked[0].score}/100`
      : '',
  };
}

function _countAssets(bundle) {
  return (bundle.ads?.length || 0) +
    (bundle.landing_page ? 1 : 0) +
    (bundle.hooks?.length || 0) +
    (bundle.cta?.length || 0) +
    (bundle.scripts?.length || 0) +
    (bundle.email?.length || 0);
}

function _computeFunnelCoverage(bundle) {
  const stages = new Set();
  if (bundle.ads?.length || bundle.hooks?.length || bundle.scripts?.length) stages.add('top_of_funnel');
  if (bundle.landing_page || bundle.email?.length) stages.add('middle_of_funnel');
  if (bundle.cta?.length) stages.add('conversion');
  return [...stages];
}

module.exports = { bundleAssets, FUNNEL_STAGES };
