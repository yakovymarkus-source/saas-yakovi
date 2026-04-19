'use strict';
/**
 * execution/core/consistency-check.js
 * Cross-asset consistency check.
 * Ensures same pain, offer direction, and CTA across all generated assets.
 */

function checkConsistency(assets, brief, messageCore) {
  const issues = [];
  const summary = {};

  const expectedPain    = brief.selectedPain || '';
  const expectedOffer   = messageCore?.corePromise?.transformation || '';
  const expectedCta     = messageCore?.ctaDirection?.primary || '';
  const expectedTone    = brief.tone?.tone || '';

  // Collect all asset texts for analysis
  const allTexts = [];
  for (const [assetType, assetData] of Object.entries(assets || {})) {
    const variants = Array.isArray(assetData) ? assetData : [assetData];
    for (const variant of variants) {
      allTexts.push({ assetType, text: _extractFullText(variant), variant });
    }
  }

  // ── Pain consistency ──────────────────────────────────────────────────────
  if (expectedPain) {
    const painKeywords = _extractKeywords(expectedPain);
    const missingPain = allTexts.filter(({ text }) => {
      return painKeywords.length > 0 && !painKeywords.some(kw => text.toLowerCase().includes(kw.toLowerCase()));
    });
    if (missingPain.length > 0) {
      issues.push({
        type:    'pain_missing',
        severity: 'warning',
        assets:  missingPain.map(a => a.assetType),
        message: `הכאב הראשי ("${expectedPain.slice(0,30)}") לא מוזכר בכמה נכסים`,
        fix:     'ודא שכל נכס מתייחס לכאב המרכזי',
      });
    }
  }

  // ── CTA direction consistency ─────────────────────────────────────────────
  const ctaTexts = allTexts.map(({ variant }) => _extractCta(variant)).filter(Boolean);
  const uniqueCtaTypes = new Set(ctaTexts.map(cta => _classifyCtaType(cta)));
  if (uniqueCtaTypes.size > 2) {
    issues.push({
      type:     'cta_inconsistent',
      severity: 'warning',
      ctaTypes: [...uniqueCtaTypes],
      message:  `יותר מדי סוגי CTA שונים (${uniqueCtaTypes.size}) — הלקוח יתבלבל`,
      fix:      'אחד את כיוון ה-CTA לסוג אחד עיקרי',
    });
  }

  // ── Offer direction consistency ───────────────────────────────────────────
  const landingPageAsset = assets?.landing_page;
  const adAssets         = assets?.ads;
  if (landingPageAsset && adAssets) {
    const lpConversion   = _detectConversionType(landingPageAsset);
    const adConversions  = (Array.isArray(adAssets) ? adAssets : [adAssets])
      .map(_detectConversionType).filter(Boolean);
    const adConvSet = new Set(adConversions);
    if (lpConversion && adConvSet.size > 0 && !adConvSet.has(lpConversion)) {
      issues.push({
        type:     'funnel_mismatch',
        severity: 'error',
        message:  `המודעות מובילות ל-"${adConversions[0]}" אבל דף הנחיתה מציג "${lpConversion}" — יש חוסר התאמה במשפך`,
        fix:      'ודא שמודעות ודף נחיתה מפנים לאותו המרה',
      });
    }
  }

  // ── Tone consistency ─────────────────────────────────────────────────────
  const toneSignals = allTexts.map(({ text }) => _detectToneSignal(text));
  const dominantTone = _mostFrequent(toneSignals);
  if (expectedTone && dominantTone && dominantTone !== expectedTone && dominantTone !== 'neutral') {
    issues.push({
      type:     'tone_drift',
      severity: 'info',
      expected: expectedTone,
      detected: dominantTone,
      message:  `הטון המזוהה (${dominantTone}) חורג מהטון המתוכנן (${expectedTone})`,
      fix:      `ודא שכל הנכסים משמרים טון ${expectedTone}`,
    });
  }

  summary.painKeywords   = _extractKeywords(expectedPain);
  summary.ctaTypes       = [...uniqueCtaTypes];
  summary.dominantTone   = dominantTone;
  summary.assetCount     = allTexts.length;

  const hasBlockingError = issues.some(i => i.severity === 'error');

  return {
    issues,
    summary,
    hasBlockingError,
    isConsistent: issues.length === 0,
    passedChecks: hasBlockingError ? 'FAIL' : (issues.length === 0 ? 'PASS' : 'WARNINGS'),
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _extractFullText(asset) {
  if (!asset) return '';
  if (typeof asset === 'string') return asset;
  const parts = [
    asset.hook, asset.headline, asset.body, asset.content,
    asset.cta, asset.cta_text, asset.description,
    asset.script, asset.subject,
  ];
  return parts.filter(Boolean).join(' ');
}

function _extractCta(asset) {
  return asset?.cta || asset?.cta_text || asset?.call_to_action || '';
}

function _extractKeywords(text) {
  if (!text) return [];
  return text.split(/[\s,—]+/).filter(w => w.length > 3).slice(0, 5);
}

function _classifyCtaType(cta) {
  const c = cta.toLowerCase();
  if (c.includes('שיחה') || c.includes('ייעוץ')) return 'consultation';
  if (c.includes('הורד') || c.includes('קבל'))    return 'free_resource';
  if (c.includes('קנה') || c.includes('הצטרף'))   return 'purchase';
  if (c.includes('גלה') || c.includes('קרא'))     return 'discovery';
  return 'generic';
}

function _detectConversionType(asset) {
  const text = _extractFullText(asset).toLowerCase();
  if (text.includes('שיחה') || text.includes('ייעוץ')) return 'consultation';
  if (text.includes('הורד') || text.includes('מדריך')) return 'free_resource';
  if (text.includes('קנה') || text.includes('הצטרף')) return 'purchase';
  return null;
}

function _detectToneSignal(text) {
  const t = text.toLowerCase();
  if (/(תקיף|מוכח|מומחה|הפתרון היחיד)/.test(t)) return 'authority';
  if (/(מבין|יודע|עוזר|תמיכה|ביחד)/.test(t))    return 'empathetic';
  if (/(ישירות|בפשטות|בדיוק|כך)/.test(t))        return 'direct';
  return 'neutral';
}

function _mostFrequent(arr) {
  if (!arr.length) return null;
  const counts = {};
  for (const v of arr) counts[v] = (counts[v] || 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

module.exports = { checkConsistency };
