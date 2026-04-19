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

// ── 8. Friction Points ────────────────────────────────────────────────────────
function checkFrictionPoints(assets) {
  const issues = [];
  let score = 100;

  const lp = assets.landing_page?.content?.sections || {};

  // Form field count (if form section exists)
  const formFields = lp.form?.fields || lp.cta_section?.fields || [];
  if (formFields.length > 4) {
    issues.push({ issue: `${formFields.length} שדות בטופס — יותר מדי (מקסימום 3–4)`, fix: 'קצץ לשם+טלפון או שם+אימייל בלבד', severity: 'high' });
    score -= 20;
  }

  // CTA visibility — CTA should appear early, not only at bottom
  const sectionKeys = Object.keys(lp);
  const heroIndex   = sectionKeys.indexOf('hero');
  const ctaIndex    = sectionKeys.findIndex(k => k.includes('cta'));
  if (ctaIndex > 4 && heroIndex === 0) {
    issues.push({ issue: 'CTA ראשון מופיע רחוק מדי למטה', fix: 'הוסף CTA כבר ב-hero section', severity: 'medium' });
    score -= 15;
  }

  // Text density — too many sections = confusion
  if (sectionKeys.length > 8) {
    issues.push({ issue: `${sectionKeys.length} סקשנים בדף — יותר מדי`, fix: 'צמצם ל-5–6 סקשנים ממוקדים', severity: 'medium' });
    score -= 10;
  }

  // Navigation links that take user away
  const hasNavLinks = /href=|<a /.test(JSON.stringify(lp));
  if (hasNavLinks) {
    issues.push({ issue: 'קישורי ניווט בדף — מסיחי דעת', fix: 'הסר כל קישור שמוציא את המשתמש מהדף', severity: 'medium' });
    score -= 10;
  }

  return { score: Math.max(score, 0), issues, friction_level: score >= 80 ? 'low' : score >= 50 ? 'medium' : 'high' };
}

// ── 9. LP Hierarchy Check ─────────────────────────────────────────────────────
function checkLpHierarchy(assets) {
  const issues = [];
  const lp = assets.landing_page?.content?.sections || {};
  const sections = Object.keys(lp);

  if (sections.length === 0) return { passed: true, issues: [], note: 'אין דף נחיתה' };

  const IDEAL_ORDER = ['hero', 'pain', 'solution', 'offer', 'proof', 'cta'];
  const orderIssues = [];

  // Hero must be first
  if (sections[0] !== 'hero') {
    orderIssues.push({ issue: `הסקשן הראשון הוא "${sections[0]}" במקום hero`, fix: 'hero תמיד ראשון — זה החלון הראשון', severity: 'high' });
  }

  // Proof/social before offer = wrong (trust before the ask is ok, but offer before pain = wrong)
  const painIdx  = sections.findIndex(s => s.includes('pain') || s.includes('problem'));
  const offerIdx = sections.findIndex(s => s.includes('offer') || s.includes('product'));
  if (offerIdx >= 0 && painIdx >= 0 && offerIdx < painIdx) {
    orderIssues.push({ issue: 'ההצעה מגיעה לפני הכאב — קפיצה מהירה מדי', fix: 'הצג את הכאב לפני הפתרון', severity: 'medium' });
  }

  // CTA must exist
  const hasCta = sections.some(s => s.includes('cta') || lp[s]?.cta || lp[s]?.button);
  if (!hasCta) {
    orderIssues.push({ issue: 'אין CTA ברור בדף', fix: 'הוסף לפחות CTA אחד ברור לפני fold', severity: 'critical' });
  }

  issues.push(...orderIssues);
  return { passed: issues.length === 0, issues, section_order: sections, ideal_order: IDEAL_ORDER };
}

// ── 10. Implementation Readiness ──────────────────────────────────────────────
function checkImplementationReadiness(assets) {
  const issues = [];
  let readinessScore = 100;

  // Ads have actual text (not just placeholders)
  for (const ad of (assets.ads || [])) {
    const t = ad.text || ad;
    if (!t.headline || t.headline.includes('[') || t.headline.includes('placeholder')) {
      issues.push({ issue: 'מודעה עם כותרת placeholder — לא מוכנה לפרסום', severity: 'critical', fix: 'החלף placeholder בטקסט אמיתי' });
      readinessScore -= 25;
    }
    if (!t.primary_text || _wordCount(t.primary_text) < 10) {
      issues.push({ issue: 'טקסט מודעה קצר מדי לפרסום', severity: 'high', fix: 'הרחב ל-30–80 מילה' });
      readinessScore -= 15;
    }
  }

  // LP has real content (hero with headline + CTA)
  const lpHero = assets.landing_page?.content?.sections?.hero;
  if (assets.landing_page && !lpHero?.headline) {
    issues.push({ issue: 'דף נחיתה ללא כותרת hero — לא מוכן לפרסום', severity: 'critical', fix: 'הוסף headline בסקשן hero' });
    readinessScore -= 30;
  }

  // Hooks exist and have text
  const emptyHooks = (assets.hooks || []).filter(h => !h.text || _charCount(h.text) < 15);
  if (emptyHooks.length > 0) {
    issues.push({ issue: `${emptyHooks.length} hooks ריקים או קצרים מדי`, severity: 'medium', fix: 'כל hook צריך לפחות 15 תווים' });
    readinessScore -= 10;
  }

  const ready = readinessScore >= 70;
  return { ready, readiness_score: Math.max(readinessScore, 0), issues, can_deploy_now: ready };
}

// ── 11. Market Saturation Fit ─────────────────────────────────────────────────
function checkMarketSaturationFit(assets, researchContext) {
  const saturation = researchContext?.marketSaturation || researchContext?.saturation || 'unknown';
  const competitors = (researchContext?.competitors || []).length;
  const allText = _gatherAllText(assets);

  const issues = [];
  let recommendation = '';

  if (saturation === 'high' || competitors > 5) {
    // Saturated market: needs extreme differentiation
    const isExtreme = /מבטיח|מוכח|תוצאות|ב-\d+|שאף אחד|ראשון|בלעדי/.test(allText);
    if (!isExtreme) {
      issues.push({ issue: 'שוק רווי — הקופי לא מספיק קיצוני/ייחודי', fix: 'הוסף תוצאה מספרית, claim חזק, או זווית שאף אחד לא השתמש בה', severity: 'high' });
    }
    recommendation = 'שוק רווי — חייבים claim חזק ובידול ברור, אחרת נאבד בים המודעות';
  } else if (saturation === 'low' || competitors <= 2) {
    // Low saturation: needs clarity, not extremeness
    const isClean = _wordCount(_gatherAllText(assets)) > 30;
    recommendation = 'שוק פתוח — התמקד בבהירות ולא בקיצוניות, הקהל עדיין לא חשוף לרעיון';
  } else {
    recommendation = 'רמת רוויה לא ידועה — בסס על נתוני מחקר לדיוק';
  }

  return { saturation_level: saturation, issues, recommendation, competitors_count: competitors };
}

// ── 12. Message Clarity Under Pressure (1-2 second scan) ─────────────────────
function checkMessageClarity(assets) {
  const issues = [];
  const headline = _getPrimaryHeadline(assets);
  const firstHook = (assets.hooks || [])[0]?.text || '';

  // Headline clarity: should communicate value in < 8 words ideally
  const headlineWords = _wordCount(headline);
  if (headlineWords > 12) {
    issues.push({ issue: `כותרת ארוכה מדי (${headlineWords} מילות) — לא ברורה תוך שנייה`, fix: 'קצץ לכותרת של 6–10 מילים עם הבטחה ברורה', severity: 'medium' });
  }

  // Headline has no clear value signal
  const valueSignals = /תוצאה|חסוך|הגדל|הרווח|פתרון|שיפור|\d+%|\d+ ש"ח|בחינם|מהר/.test(headline);
  if (headline && !valueSignals) {
    issues.push({ issue: 'הכותרת אינה מעבירה ערך ברור', fix: 'הוסף תוצאה/מספר/הבטחה ספציפית לכותרת', severity: 'high' });
  }

  // Hook must be short enough for thumb-stop (< 100 chars ideal)
  if (firstHook && _charCount(firstHook) > 150) {
    issues.push({ issue: 'הוק ראשון ארוך מדי לעצירת גלילה', fix: 'קצץ הוק ראשון ל-60–100 תווים', severity: 'medium' });
  }

  const score = 100 - (issues.length * 20);
  return { score: Math.max(score, 0), issues, headline_words: headlineWords, clear_in_2sec: issues.length === 0 };
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
  checkFrictionPoints,
  checkLpHierarchy,
  checkImplementationReadiness,
  checkMarketSaturationFit,
  checkMessageClarity,
  detectKillSignals,
  checkLanguage,
  checkAwarenessMatch,
  checkTrustSignals,
  checkTracking,
  checkEndToEndFlow,
};
