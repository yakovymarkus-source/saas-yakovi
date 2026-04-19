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
};
