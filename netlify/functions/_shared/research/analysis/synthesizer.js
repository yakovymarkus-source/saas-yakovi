'use strict';

/**
 * research/analysis/synthesizer.js
 * Cross-references competitors and avatar signals to produce:
 * - patterns (what repeats in the market)
 * - gaps    (what's missing / underserved)
 * - opportunities (where the user can win)
 * - avatar↔competitor link (who solves what pain, who doesn't)
 *
 * All insights require evidence. No insight without a reference.
 */

async function callClaude(apiKey, model, system, user, maxTokens = 2500) {
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), 22000);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
    });
    clearTimeout(timer);
    const data = await res.json();
    return data?.content?.find(b => b.type === 'text')?.text || '';
  } finally { clearTimeout(timer); }
}

function parseJson(raw) {
  const m = raw.match(/```json\s*([\s\S]*?)\s*```/) || raw.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
  try { return JSON.parse(m ? m[1] : raw); } catch { return null; }
}

// Pattern detection: what repeats across competitors AND avatar signals
async function detectPatterns({ apiKey, model, entities, avatarAnalysis, niche }) {
  const competitorNames = entities.map(e => e.name).join(', ');
  const topPains        = avatarAnalysis.corePains.slice(0, 5).join('; ');
  const dominantMsgs    = entities.map(e => e.key_message).filter(Boolean).join('; ');

  const prompt = `נתח דפוסים בשוק "${niche}".

מתחרים: ${competitorNames}
מסרים נפוצים: ${dominantMsgs}
כאבי קהל יעד: ${topPains}

זהה דפוסים שחוזרים:
1. מסרים שיווקיים דומיננטיים שכולם משתמשים בהם
2. סוגי הצעות שחוזרים
3. קהלי יעד שכולם מכוונים אליהם
4. נושאים שנמנעים מכולם

החזר JSON:
[
  {
    "type": "pattern",
    "title": "שם הדפוס",
    "description": "תיאור מה חוזר",
    "evidence": ["ראיה1", "ראיה2"],
    "impact_score": 75,
    "confidence": 80,
    "priority": "high|medium|low"
  }
]

רק דפוסים עם confidence >= 60. מקסימום 5.`;

  const raw    = await callClaude(apiKey, model, 'אתה חוקר שוק. החזר JSON בלבד.', prompt);
  const result = parseJson(raw);
  return Array.isArray(result) ? result.filter(i => i.confidence >= 60) : [];
}

// Gap detection: what's MISSING in the market that the user can fill
async function detectGaps({ apiKey, model, entities, avatarAnalysis, niche, adsIntelligence }) {
  const unsolvedPains  = avatarAnalysis.corePains.slice(0, 5).join('; ');
  const fears          = avatarAnalysis.coreFears.slice(0, 3).join('; ');
  const existingOffers = adsIntelligence?.common_offers?.join(', ') || 'לא ידוע';

  const prompt = `מצא פערים בשוק "${niche}".

כאבים עיקריים של הקהל: ${unsolvedPains}
פחדים: ${fears}
הצעות קיימות בשוק: ${existingOffers}
מתחרים: ${entities.map(e => e.name).join(', ')}

מה לא נפתר? מה הקהל לא מקבל מענה עליו?
מה המתחרים מתעלמים ממנו?
איפה יש הזדמנות לבידול אמיתי?

החזר JSON:
[
  {
    "type": "gap",
    "title": "שם הפער",
    "description": "מה חסר בשוק",
    "evidence": ["ראיה"],
    "impact_score": 85,
    "confidence": 75,
    "priority": "high|medium|low",
    "action_required": true
  }
]

רק פערים אמיתיים עם ראיה. מקסימום 5.`;

  const raw    = await callClaude(apiKey, model, 'אתה חוקר שוק. החזר JSON בלבד.', prompt);
  const result = parseJson(raw);
  return Array.isArray(result) ? result.filter(i => i.confidence >= 60) : [];
}

// Opportunity builder: cross-reference pain → who solves it, who doesn't
async function buildOpportunities({ apiKey, model, entities, avatarAnalysis, patterns, gaps, niche }) {
  const topPains = avatarAnalysis.corePains.slice(0, 4).join('; ');
  const topGaps  = gaps.slice(0, 3).map(g => g.title).join('; ');
  const prompt = `בנה הזדמנויות שיווקיות עבור עסק בנישת "${niche}".

כאבים עיקריים: ${topPains}
פערים שזוהו: ${topGaps}
מתחרים: ${entities.map(e => e.name + ' (' + e.priority + ')').join(', ')}

לכל הזדמנות, ציין:
- מה הכאב שנפתר
- מי מהמתחרים פותר אותו (ומי לא)
- מה ההזדמנות לבידול

החזר JSON:
[
  {
    "type": "opportunity",
    "title": "שם ההזדמנות",
    "description": "מה אפשר לעשות",
    "pain_addressed": "הכאב שנפתר",
    "competitors_addressing": ["מתחרה1"],
    "competitors_missing": ["מתחרה2"],
    "evidence": ["ראיה"],
    "impact_score": 80,
    "confidence": 75,
    "priority": "high",
    "action_required": true
  }
]

מקסימום 5 הזדמנויות.`;

  const raw    = await callClaude(apiKey, model, 'אתה אסטרטג שיווקי. החזר JSON בלבד.', prompt);
  const result = parseJson(raw);
  return Array.isArray(result) ? result.filter(i => i.confidence >= 60) : [];
}

// Recommendations: execution-ready action steps
async function buildRecommendations({ apiKey, model, niche, entities, avatarAnalysis, gaps, opportunities }) {
  const topOpp  = opportunities.slice(0, 3).map(o => o.title).join('; ');
  const topGaps = gaps.slice(0, 2).map(g => g.title).join('; ');
  const hook    = avatarAnalysis.languagePatterns[0] || avatarAnalysis.corePains[0] || '';

  const prompt = `צור המלצות פעולה מוכנות לביצוע עבור עסק בנישת "${niche}".

הזדמנויות: ${topOpp}
פערים: ${topGaps}
שפת הקהל: ${hook}

לכל המלצה:
- מה לעשות
- למה עכשיו
- מה הפעולה הראשונה

החזר JSON:
[
  {
    "title": "כותרת ההמלצה",
    "summary": "משפט אחד — מה לעשות",
    "why_now": "למה דחוף",
    "action_steps": ["שלב 1", "שלב 2", "שלב 3"],
    "recommended_angle": "זווית ה-hook המומלצת",
    "hook": "משפט פתיחה לקמפיין",
    "core_message": "המסר המרכזי",
    "content_type": "סרטון|מודעה|דף נחיתה|מאמר",
    "platform": "פייסבוק|אינסטגרם|גוגל|טיקטוק",
    "urgency": "high|medium|low",
    "confidence_score": 80
  }
]

מקסימום 5 המלצות.`;

  const raw    = await callClaude(apiKey, model, 'אתה אסטרטג שיווקי מבצעי. החזר JSON בלבד.', prompt, 2000);
  const result = parseJson(raw);
  return Array.isArray(result) ? result : [];
}

// Final quality score for the whole report
function computeDataQuality({ entities, signals, patterns, gaps, opportunities }) {
  const entityScore  = Math.min(100, entities.length * 15);
  const signalScore  = Math.min(100, signals.length * 2);
  const insightScore = Math.min(100, (patterns.length + gaps.length + opportunities.length) * 12);
  return Math.round((entityScore + signalScore + insightScore) / 3);
}

module.exports = { detectPatterns, detectGaps, buildOpportunities, buildRecommendations, computeDataQuality };
