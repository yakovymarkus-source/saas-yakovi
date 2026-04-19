'use strict';
/**
 * qa/core/checks.js
 * Deterministic (non-AI) QA checks.
 * Fast, rule-based: cognitive load, kill signals, language, tracking, trust, awareness match.
 */

// ── Word / char helpers ────────────────────────────────────────────────────────
const WEAK_WORDS = ['הכי טוב','מוביל','מקצועי','איכותי','מצוין','פנטסטי','מדהים','ייחודי','חדשני','פורץ דרך','עולמי','מושלם','הטוב ביותר'];
const GENERIC_OPENERS = ['האם אתה','האם ידעת','גלה את','הכירו את','אנחנו מציעים','אנחנו מתמחים','שנות ניסיון','ברוכים הבאים'];
const TRUST_INDICATORS = ['לקוחות','ביקורות','הוכחה','תוצאות','מקרה','ממליץ','ניסיון','ערבות','אחריות','הצלחה','תוצאה מוכחת','כבר','יותר מ-'];
const CTA_WORDS = ['לחץ','הצטרף','קבל','הורד','התחל','השאר','פנה','הזמן','נסה','גלה','שלח','בדוק','קנה','רכוש'];

function _wordCount(text) { return (text || '').split(/\s+/).filter(Boolean).length; }
function _charCount(text) { return (text || '').length; }
function _hasWord(text, words) { return words.some(w => (text || '').includes(w)); }

// ── 1. Cognitive Load ─────────────────────────────────────────────────────────
function checkCognitiveLoad(assets) {
  const issues = [];
  let score = 100;

  const allText = _gatherAllText(assets);
  const totalWords = _wordCount(allText);

  // LP overload
  const lp = assets.landing_page?.content?.sections || {};
  const lpHero = lp.hero;
  if (lpHero) {
    const heroWords = _wordCount(`${lpHero.headline||''} ${lpHero.subheadline||''}`);
    if (heroWords > 25) { issues.push({ field: 'lp_hero', issue: 'כותרת ראשית ארוכה מדי', score_penalty: 15 }); score -= 15; }
  }

  // Ad overload
  for (const ad of (assets.ads || [])) {
    const t = ad.text || ad;
    const words = _wordCount(t.primary_text || '');
    if (words > 80) { issues.push({ field: 'ad_body', issue: `וריאנט ${ad.variantIndex+1}: טקסט ארוך מדי (${words} מילים)`, score_penalty: 10 }); score -= 10; }
  }

  // Hook overload
  for (const h of (assets.hooks || [])) {
    if (_charCount(h.text || h) > 120) { issues.push({ field: 'hook', issue: 'הוק ארוך מדי (>120 תווים)', score_penalty: 8 }); score -= 8; break; }
  }

  return { score: Math.max(score, 0), issues, totalWords };
}

// ── 2. Kill Signals ────────────────────────────────────────────────────────────
function detectKillSignals(assets, brief) {
  const signals = [];

  // Promise unclear — no clear outcome in headline
  const headline = _getPrimaryHeadline(assets);
  if (!headline || _wordCount(headline) < 3) {
    signals.push({ signal: 'promise_unclear', severity: 'critical', description: 'אין הבטחה ברורה בכותרת', fix: 'הוסף תוצאה/תועלת ספציפית בכותרת' });
  }

  // Trust missing
  const allText = _gatherAllText(assets);
  if (!_hasWord(allText, TRUST_INDICATORS)) {
    signals.push({ signal: 'trust_missing', severity: 'critical', description: 'אין אלמנטים של אמון (הוכחות, לקוחות, תוצאות)', fix: 'הוסף מספרים, עדויות, או ערבות' });
  }

  // CTA weak/missing
  const ctaText = _gatherCtaText(assets);
  if (!_hasWord(ctaText, CTA_WORDS) && _charCount(ctaText) < 5) {
    signals.push({ signal: 'cta_missing', severity: 'critical', description: 'CTA חסר או חלש מאוד', fix: 'הוסף CTA חד וברור עם פועל פעולה' });
  }

  // Generic / no differentiation
  if (_hasWord(allText, WEAK_WORDS) && !brief?.positioning && !brief?.whyUs) {
    signals.push({ signal: 'generic_copy', severity: 'high', description: 'שפה גנרית ללא בידול', fix: 'החלף מילות buzzword בתועלות ספציפיות' });
  }

  // Cognitive overload
  const lp = assets.landing_page?.content?.sections || {};
  const bodyWords = _wordCount(lp.body?.text || '');
  if (bodyWords > 300) {
    signals.push({ signal: 'cognitive_overload', severity: 'high', description: `עומס טקסט (${bodyWords} מילים)`, fix: 'חתוך ל-150 מילה מקסימום, העבר לפסקאות קצרות' });
  }

  return { signals, count: signals.length, hasCritical: signals.some(s => s.severity === 'critical') };
}

// ── 3. Language Check ─────────────────────────────────────────────────────────
function checkLanguage(assets, brief) {
  const issues = [];
  let score = 100;

  const allText = _gatherAllText(assets);

  // Generic openers
  if (_hasWord(allText, GENERIC_OPENERS)) {
    issues.push({ issue: 'פתיחה גנרית', fix: 'החלף לפתיחה עם כאב/תוצאה ספציפית', penalty: 15 });
    score -= 15;
  }

  // Weak buzzwords
  const weakFound = WEAK_WORDS.filter(w => (allText).includes(w));
  if (weakFound.length > 2) {
    issues.push({ issue: `${weakFound.length} מילות buzzword חלשות (${weakFound.slice(0,3).join(', ')})`, fix: 'החלף עם תוצאות מדידות', penalty: 20 });
    score -= 20;
  }

  // Too formal / too casual detection (basic heuristic)
  const userLevel = brief?.userLevel || 'standard';
  const avgSentenceLen = _avgSentenceLength(allText);
  if (userLevel === 'beginner' && avgSentenceLen > 20) {
    issues.push({ issue: 'משפטים ארוכים מדי לקהל מתחיל', fix: 'פצל למשפטים קצרים (עד 15 מילה)', penalty: 10 });
    score -= 10;
  }

  return { score: Math.max(score, 0), issues, weakWordsFound: weakFound };
}

// ── 4. Awareness Match ────────────────────────────────────────────────────────
function checkAwarenessMatch(assets, awarenessLevel) {
  const issues = [];
  const level = awarenessLevel || 'problem_aware';

  const ctaText = _gatherCtaText(assets);
  const allText = _gatherAllText(assets);

  const hardCtaWords = ['קנה עכשיו','רכוש','הזמן עכשיו','קנה היום'];
  const hasHardCta = _hasWord(ctaText + allText, hardCtaWords);

  // Unaware audience gets hard CTA = too pushy
  if (level === 'unaware' && hasHardCta) {
    issues.push({ issue: 'CTA אגרסיבי מדי לקהל לא מודע', fix: 'רכך ל-CTA מסוג "גלה עוד" / "קרא איך"', severity: 'high' });
  }

  // Product-aware audience gets only soft CTA = too weak
  if (level === 'product_aware' && !hasHardCta) {
    issues.push({ issue: 'CTA חלש מדי לקהל שמוכן לקנות', fix: 'חזק ל-"קנה עכשיו" / "הצטרף היום"', severity: 'medium' });
  }

  // Solution-aware — needs comparison, if missing flag
  const hasComparison = /לעומת|בניגוד|שלא כמו|בהשוואה/.test(allText);
  if (level === 'solution_aware' && !hasComparison) {
    issues.push({ issue: 'חסר אלמנט השוואה לקהל שמכיר פתרונות', fix: 'הוסף נקודת בידול ברורה', severity: 'medium' });
  }

  const passed = issues.length === 0;
  return { passed, issues, awarenessLevel: level };
}

// ── 5. Trust Signals ─────────────────────────────────────────────────────────
function checkTrustSignals(assets) {
  const allText = _gatherAllText(assets);
  const found = [];
  const missing = [];

  const trustChecks = [
    { name: 'מספרים/סטטיסטיקה', pattern: /\d+[\s%+]*(לקוחות|עסקים|תוצאות|שנה|חודש|יום|שעה|ק"ג|ש"ח|\$|€)/ },
    { name: 'ערבות/אחריות',     pattern: /ערבות|אחריות|החזר כסף|לא שבע|100%/ },
    { name: 'עדויות/המלצות',   pattern: /ממליץ|המלץ|אמרו|כתב|"[^"]{10,}"/ },
    { name: 'תוצאות מוכחות',   pattern: /הצליח|הגיע|השיג|תוצאה|עלייה|ירידה|שיפור/ },
    { name: 'לוגו/מותג ידוע',  pattern: /פורבס|גוגל|Meta|Facebook|ישראל היום/ },
  ];

  for (const check of trustChecks) {
    if (check.pattern.test(allText)) found.push(check.name);
    else missing.push(check.name);
  }

  const score = Math.round((found.length / trustChecks.length) * 100);
  return { score, found, missing, sufficient: found.length >= 2 };
}

// ── 6. Tracking Validation ────────────────────────────────────────────────────
function checkTracking(trackingLayer) {
  const issues = [];
  const t = trackingLayer || {};

  if (!t.pixels || t.pixels.length === 0) {
    issues.push({ issue: 'לא מוגדר אף פיקסל', severity: 'critical', fix: 'הטמע Meta Pixel / GA4 לפני שיגור' });
  }
  if (!t.eventMap || t.eventMap.length === 0) {
    issues.push({ issue: 'אין events מוגדרים', severity: 'critical', fix: 'הגדר events: Lead, Purchase, PageView לפחות' });
  }
  const hasConversionEvent = (t.eventMap || []).some(e => ['Lead','Purchase','CompleteRegistration','generate_lead','purchase'].includes(e.event));
  if (!hasConversionEvent) {
    issues.push({ issue: 'אין event המרה מוגדר', severity: 'critical', fix: 'הגדר event של Lead או Purchase' });
  }

  const pixel_installed = (t.pixels || []).length > 0;
  const events_connected = (t.eventMap || []).length > 0;

  return {
    pixel_installed,
    events_connected,
    conversion_event: hasConversionEvent,
    issues,
    ready: issues.filter(i => i.severity === 'critical').length === 0,
  };
}

// ── 7. Flow Check (End-to-End: ad → LP → action) ─────────────────────────────
function checkEndToEndFlow(assets, brief) {
  const issues = [];

  const adCta  = _gatherCtaText(assets);
  const lpHero = assets.landing_page?.content?.sections?.hero;
  const lpCta  = lpHero?.cta || '';

  // Message match: ad CTA should align with LP CTA
  if (adCta && lpCta) {
    const adWords = new Set(adCta.toLowerCase().split(/\s+/));
    const lpWords = new Set(lpCta.toLowerCase().split(/\s+/));
    const overlap = [...adWords].filter(w => w.length > 3 && lpWords.has(w));
    if (overlap.length === 0) {
      issues.push({ issue: 'CTA במודעה לא תואם CTA בדף נחיתה', fix: 'יישר מסר: אם המודעה אומרת "קבל" — הדף אומר "קבל"', severity: 'medium' });
    }
  }

  // Pain in ad should resonate in LP
  const adHook = (assets.hooks || [])[0]?.text || '';
  const lpSubheadline = lpHero?.subheadline || '';
  if (adHook && lpSubheadline) {
    // Very basic: just check keyword overlap
    const adKeywords = adHook.toLowerCase().split(/\s+/).filter(w => w.length > 4);
    const lpKeywords = lpSubheadline.toLowerCase().split(/\s+/);
    const matched = adKeywords.filter(k => lpKeywords.some(l => l.includes(k)));
    if (matched.length === 0 && adHook.length > 20) {
      issues.push({ issue: 'הוק המודעה לא מתחבר לנרטיב הדף', fix: 'ה-LP חייב להמשיך את הכאב/הבטחה מהמודעה', severity: 'medium' });
    }
  }

  return { passed: issues.length === 0, issues };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function _gatherAllText(assets) {
  const parts = [];
  for (const h of (assets.hooks || [])) parts.push(h.text || h);
  for (const c of (assets.cta  || [])) parts.push(c.text || c);
  for (const ad of (assets.ads || [])) {
    const t = ad.text || ad;
    parts.push(t.headline || '', t.primary_text || '', t.description || '');
  }
  const lp = assets.landing_page?.content?.sections || {};
  for (const s of Object.values(lp)) {
    if (typeof s === 'object') parts.push(JSON.stringify(s));
  }
  return parts.join(' ');
}

function _gatherCtaText(assets) {
  return (assets.cta || []).map(c => c.text || c).join(' ');
}

function _getPrimaryHeadline(assets) {
  const ad = (assets.ads || [])[0];
  if (ad) return (ad.text || ad).headline || '';
  const lp = assets.landing_page?.content?.sections?.hero;
  if (lp) return lp.headline || '';
  return (assets.hooks || [])[0]?.text || '';
}

function _avgSentenceLength(text) {
  const sentences = (text || '').split(/[.!?]/);
  if (sentences.length === 0) return 0;
  const total = sentences.reduce((sum, s) => sum + _wordCount(s), 0);
  return Math.round(total / sentences.length);
}

module.exports = {
  checkCognitiveLoad,
  detectKillSignals,
  checkLanguage,
  checkAwarenessMatch,
  checkTrustSignals,
  checkTracking,
  checkEndToEndFlow,
};
