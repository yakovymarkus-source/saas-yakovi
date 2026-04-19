'use strict';
/**
 * qa/collectors/claude-qa-engine.js
 * AI-powered semantic QA checks.
 * Uses Claude to evaluate: hook strength, pain depth, differentiation,
 * offer quality, persuasion flow, variant ranking, and correction generation.
 */

const { callClaude } = require('../../providers/adapters/claude');

// ── Hook Strength ─────────────────────────────────────────────────────────────
async function evaluateHooks({ hooks, brief, researchContext }) {
  const hookList = (hooks || []).slice(0, 8).map((h, i) => `${i+1}. ${h.text || h}`).join('\n');
  const market   = researchContext?.topHooks?.slice(0, 3).join('\n') || 'אין נתוני שוק';

  const prompt = `אתה מומחה בדיקת קופי שיווקי.

פלטפורמה: ${brief?.platform}
קהל: ${brief?.targetCustomer || 'לא צוין'}
כאב: ${brief?.selectedPain}

הוקים שנוצרו:
${hookList}

הוקים מהשוק (לעיון):
${market}

בדוק כל הוק לפי:
1. עוצר גלילה? (surprising, painful, curious)
2. שונה מהשוק? (לא עוד מאותו דבר)
3. ספציפי? (מדבר לכאב אמיתי)

החזר JSON בלבד:
{
  "hooks_analysis": [
    {
      "index": 1,
      "score": 0-100,
      "stop_power": "high|medium|low",
      "is_generic": true/false,
      "issue": "תיאור קצר אם יש בעיה",
      "fix": "תיקון ספציפי אם נדרש"
    }
  ],
  "top_hook_index": 1,
  "weakest_hook_index": 1,
  "overall_hook_score": 0-100,
  "market_comparison": "נראה כמו השוק|שונה חלקית|ייחודי"
}`;

  const raw = await callClaude({ prompt, maxTokens: 800, temperature: 0.2 });
  return _parseJson(raw, { hooks_analysis: [], overall_hook_score: 50, market_comparison: 'נראה כמו השוק' });
}

// ── Pain & Differentiation ────────────────────────────────────────────────────
async function evaluatePainAndDifferentiation({ assets, brief, researchContext }) {
  const headline   = _getHeadline(assets);
  const primaryAd  = (assets.ads || [])[0];
  const adText     = primaryAd ? JSON.stringify(primaryAd.text || primaryAd) : 'אין מודעה';
  const pains      = researchContext?.topPains?.slice(0, 3).join(', ') || 'אין נתונים';
  const competitors= researchContext?.competitors?.slice(0, 2).map(c => c.mainAngle || c).join(', ') || 'אין נתונים';

  const prompt = `בדוק את הקופי הזה לעמוק יותר:

כותרת: ${headline}
מודעה: ${adText}

כאבים שחוזרים בשוק: ${pains}
זוויות של מתחרים: ${competitors}
בידול מוצהר: ${brief?.whyUs || 'לא צוין'}

שאלות:
1. הכאב אמיתי ועמוק — או שטחי?
2. יש בידול אמיתי — או עוד אחד מהשוק?
3. השפה נשמעת כמו בן אדם — או רובוט?

החזר JSON:
{
  "pain_depth": "deep|moderate|shallow",
  "pain_score": 0-100,
  "pain_issue": "תיאור אם שטחי",
  "differentiation": { "unique": true/false, "score": 0-100, "issue": "תיאור" },
  "language_humanness": "human|robotic|mixed",
  "language_score": 0-100,
  "top_issue": "הבעיה הכי גדולה",
  "quick_fix": "תיקון מהיר ספציפי"
}`;

  const raw = await callClaude({ prompt, maxTokens: 600, temperature: 0.2 });
  return _parseJson(raw, { pain_depth: 'moderate', pain_score: 50, differentiation: { unique: false, score: 50 }, language_score: 50 });
}

// ── Offer & Persuasion Flow ───────────────────────────────────────────────────
async function evaluateOfferAndPersuasion({ assets, brief, offer }) {
  const lp   = assets.landing_page?.content?.sections || {};
  const offerSection = lp.offer || {};
  const ctas = (assets.cta || []).map(c => c.text || c).join(', ');

  const prompt = `בדוק את ההצעה ורצף השכנוע:

הצעה: ${JSON.stringify(offerSection)}
CTAs: ${ctas}
ערבות: ${offer?.guaranteeLine || 'אין'}
דחיפות: ${offer?.urgencyLine || 'אין'}

פלטפורמה: ${brief?.platform}
שלב משפך: ${brief?.funnel || 'לא צוין'}

שאלות:
1. האם ההצעה מספיק חזקה מול השוק?
2. האם יש רצף הגיוני (כאב → פתרון → הצעה → CTA)?
3. האם יש סיבה לפעול עכשיו?
4. איפה הקורא מתנתק?

החזר JSON:
{
  "offer_strength": "strong|moderate|weak",
  "offer_score": 0-100,
  "has_urgency": true/false,
  "persuasion_flow": "logical|gaps|broken",
  "persuasion_score": 0-100,
  "break_points": ["נקודה 1", "נקודה 2"],
  "offer_fix": "תיקון ספציפי",
  "persuasion_fix": "תיקון ספציפי"
}`;

  const raw = await callClaude({ prompt, maxTokens: 600, temperature: 0.2 });
  return _parseJson(raw, { offer_score: 50, persuasion_score: 50, break_points: [], persuasion_flow: 'gaps' });
}

// ── Variant Comparison ────────────────────────────────────────────────────────
async function compareVariants({ assets, brief }) {
  const ads = (assets.ads || []).slice(0, 5);
  if (ads.length < 2) return { top_variant: 0, ranking: [], recommendation: 'רק וריאנט אחד — אין מה להשוות' };

  const variantList = ads.map((ad, i) => {
    const t = ad.text || ad;
    return `וריאנט ${i+1} [${ad.angleType || ad.theme || ''}]:\nכותרת: ${t.headline || ''}\nטקסט: ${(t.primary_text || '').slice(0, 100)}`;
  }).join('\n\n');

  const prompt = `השווה את הוריאציות ודרג אותן:

${variantList}

פלטפורמה: ${brief?.platform}
קהל: ${brief?.targetCustomer}

דרג כל וריאנט (1=הכי חזק) ונמק בקצרה.
החזר JSON:
{
  "ranking": [
    { "index": 0, "rank": 1, "score": 0-100, "why_strong": "...", "why_weak": "..." }
  ],
  "top_variant": 0,
  "bottom_variant": 1,
  "recommendation": "הסבר קצר"
}`;

  const raw = await callClaude({ prompt, maxTokens: 700, temperature: 0.2 });
  return _parseJson(raw, { top_variant: 0, ranking: [], recommendation: 'לא ניתן להשוות' });
}

// ── Corrections Generator ─────────────────────────────────────────────────────
async function generateCorrections({ allIssues, assets, brief }) {
  if (!allIssues || allIssues.length === 0) return { corrections: [], count: 0 };

  const issueList = allIssues.slice(0, 10).map((iss, i) => `${i+1}. [${iss.source}] ${iss.issue}`).join('\n');

  const prompt = `בהתבסס על הבעיות האלה:
${issueList}

פלטפורמה: ${brief?.platform}
מצב ביצוע: ${brief?.executionMode}

צור הוראות תיקון מדויקות — לא "שפר את זה" אלא פעולה ספציפית.

החזר JSON:
{
  "corrections": [
    {
      "asset": "ads|hooks|landing_page|email|cta",
      "issue": "תיאור הבעיה",
      "fix": "פעולה ספציפית שצריך לעשות",
      "priority": "critical|high|medium|low",
      "example": "דוגמה לפני/אחרי אם רלוונטי"
    }
  ]
}`;

  const raw = await callClaude({ prompt, maxTokens: 900, temperature: 0.3 });
  const parsed = _parseJson(raw, { corrections: [] });
  return { corrections: parsed.corrections || [], count: (parsed.corrections || []).length };
}

// ── Edge Cases + Intent Drift ─────────────────────────────────────────────────
async function evaluateEdgeCasesAndIntentDrift({ assets, brief }) {
  const headline  = _getHeadline(assets);
  const allHooks  = (assets.hooks || []).slice(0, 3).map(h => h.text || h).join('\n');
  const lpSections = Object.keys(assets.landing_page?.content?.sections || {}).join(', ');

  const prompt = `אתה מנסה לשבור את הקופי הזה מ-3 פרספקטיבות:

כותרת: ${headline}
הוקים: ${allHooks}
מבנה דף: ${lpSections}
פלטפורמה: ${brief?.platform}
קהל: ${brief?.targetCustomer}

**בדוק 3 סוגי משתמשים:**

1. **משתמש סקפטי** — "שמעתי את זה כבר" — האם הקופי מתגבר על ספקנות?
2. **משתמש קר** — לא מכיר את המוצר, רואה לראשונה — האם זה מובן?
3. **משתמש שניסה בעבר** — ניסה פתרון דומה ונכשל — האם יש בידול מספיק?

**בדוק Intent Drift:**
האם המשתמש שמגיע מסוג מסוים (כאב ספציפי) מוצא מה שחיפש — או שהדף מסיט אותו לכיוון אחר?

החזר JSON:
{
  "skeptic_response": "strong|moderate|weak",
  "cold_user_clarity": "clear|confusing|partial",
  "tried_before_differentiation": "strong|moderate|weak",
  "intent_drift": { "exists": true/false, "description": "תיאור אם יש", "fix": "פתרון" },
  "edge_case_score": 0-100,
  "top_edge_issue": "הבעיה הגדולה ביותר",
  "fix": "פתרון ספציפי"
}`;

  const raw = await callClaude({ prompt, maxTokens: 600, temperature: 0.2 });
  return _parseJson(raw, { skeptic_response: 'moderate', cold_user_clarity: 'partial', edge_case_score: 50, intent_drift: { exists: false } });
}

// ── Execution Fidelity + Visual QA ───────────────────────────────────────────
async function evaluateExecutionFidelity({ assets, brief, decisionLayer }) {
  const primaryAd = (assets.ads || [])[0];
  const adText    = primaryAd ? JSON.stringify(primaryAd.text || primaryAd).slice(0, 200) : 'אין מודעה';
  const intendedAngle   = decisionLayer?.primaryAngle || brief?.angleType || 'לא צוין';
  const intendedEmotion = decisionLayer?.emotionPrimary || 'לא צוין';
  const platform        = brief?.platform;

  const prompt = `בדוק נאמנות ביצוע — האם הנכס מיישם את ההחלטות האסטרטגיות עד הסוף:

נכס (מודעה ראשונה): ${adText}

מה היה אמור להיות:
- זווית: ${intendedAngle}
- רגש: ${intendedEmotion}
- פלטפורמה: ${platform}

שאלות:
1. האם הזווית (${intendedAngle}) באה לידי ביטוי — או נכונה על הנייר אבל חלשה בפועל?
2. האם הרגש (${intendedEmotion}) מורגש — או נשמע כמו כתיבה מכנית?
3. האם הפורמט מתאים לפלטפורמה ${platform} (אורך, מבנה, ניסוח)?
4. האם הוויזואל (אם קיים) נראה כמו פרסומת או כמו תוכן אורגני לפלטפורמה?

החזר JSON:
{
  "angle_fidelity": "strong|moderate|weak",
  "emotion_fidelity": "strong|moderate|weak",
  "platform_format_fit": "perfect|acceptable|wrong",
  "visual_platform_fit": "native|ad_like|unknown",
  "fidelity_score": 0-100,
  "fidelity_issues": ["בעיה 1", "בעיה 2"],
  "fidelity_fix": "תיקון ספציפי"
}`;

  const raw = await callClaude({ prompt, maxTokens: 500, temperature: 0.2 });
  return _parseJson(raw, { fidelity_score: 50, angle_fidelity: 'moderate', emotion_fidelity: 'moderate', fidelity_issues: [] });
}

// ── Business Fit + ROI + Content Fatigue + Scalability ───────────────────────
async function evaluateBusinessAndScalability({ assets, brief, offer }) {
  const headline    = _getHeadline(assets);
  const priceTier   = brief?.priceTier || 'medium';
  const businessType= brief?.businessType || 'b2c';
  const adCount     = (assets.ads || []).length;
  const hookCount   = (assets.hooks || []).length;

  const prompt = `בדוק התאמה עסקית, ROI פוטנציאל, ועייפות תוכן:

מוצר: ${brief?.productName || 'לא צוין'}
מחיר: ${priceTier}
קהל: ${brief?.targetCustomer}
כותרת: ${headline}
מספר נכסים: ${adCount} מודעות, ${hookCount} hooks

**1. Business Fit:**
האם הקופי מתאים לרמת המחיר (${priceTier}) ולסוג העסק (${businessType})?
קופי לproduct ב-500₪ לעומת קופי ל-50₪ = שונה לגמרי.

**2. ROI Thinking:**
על סמך עוצמת ההצעה ורמת ההמרה הצפויה — האם זה שווה להריץ?
(לא מדויק, אבל חייב להשיב: "כן/לא/תלוי ב...")

**3. Content Fatigue:**
אם מריצים את זה 4-6 שבועות — מה יישחק ראשון?

**4. Scalability:**
האם ניתן לשכפל את הגישה הזו ל-5-10 קמפיינים נוספים?

**5. Over-Optimization:**
האם יש סימנים לשיפור יתר שפוגע בפשטות?

החזר JSON:
{
  "business_fit": { "score": 0-100, "issue": "תיאור אם לא מתאים" },
  "roi_outlook": "positive|uncertain|negative",
  "roi_note": "הסבר קצר",
  "fatigue_risk": "low|medium|high",
  "fatigue_element": "מה יישחק ראשון",
  "scalable": true/false,
  "scalability_note": "הסבר",
  "over_optimized": true/false,
  "over_optimization_fix": "תיקון אם נדרש",
  "overall_business_score": 0-100
}`;

  const raw = await callClaude({ prompt, maxTokens: 600, temperature: 0.2 });
  return _parseJson(raw, { business_fit: { score: 50 }, roi_outlook: 'uncertain', fatigue_risk: 'medium', scalable: true, over_optimized: false, overall_business_score: 50 });
}

// ── Helper ────────────────────────────────────────────────────────────────────
function _getHeadline(assets) {
  const ad = (assets.ads || [])[0];
  if (ad) return (ad.text || ad).headline || '';
  return assets.landing_page?.content?.sections?.hero?.headline || '';
}

function _parseJson(raw, fallback) {
  try {
    const match = (raw || '').match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch {}
  return fallback;
}

module.exports = {
  evaluateHooks,
  evaluatePainAndDifferentiation,
  evaluateOfferAndPersuasion,
  compareVariants,
  generateCorrections,
  evaluateEdgeCasesAndIntentDrift,
  evaluateExecutionFidelity,
  evaluateBusinessAndScalability,
};
