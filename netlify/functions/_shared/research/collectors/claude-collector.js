'use strict';

/**
 * research/collectors/claude-collector.js
 * Uses Claude as the primary research engine.
 * When real APIs (SerpAPI, Meta Ads Library, Reddit) are connected,
 * they will augment or replace specific collection steps.
 * Claude provides market intelligence from its training knowledge.
 */

const { filterSignals } = require('../pii-filter');

async function callClaude(apiKey, model, systemPrompt, userPrompt, maxTokens = 2000) {
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system:     systemPrompt,
        messages:   [{ role: 'user', content: userPrompt }],
      }),
    });
    clearTimeout(timer);
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`Claude ${res.status}: ${err.slice(0, 200)}`);
    }
    const data = await res.json();
    return data?.content?.find(b => b.type === 'text')?.text || '';
  } finally {
    clearTimeout(timer);
  }
}

function parseJson(raw) {
  const match = raw.match(/```json\s*([\s\S]*?)\s*```/) || raw.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
  try { return JSON.parse(match ? match[1] : raw); } catch { return null; }
}

// ── Competitor Discovery ───────────────────────────────────────────────────────
async function discoverCompetitors({ apiKey, model, niche, businessName, targetAudience, plan }) {
  const count  = plan.maxCompetitors;
  const system = 'אתה חוקר שוק מומחה. החזר JSON בלבד, ללא הסברים.';
  const prompt = `בצע מחקר מתחרים בנישה: "${niche}".
עסק שחוקר: "${businessName || 'לא צוין'}". קהל יעד: "${targetAudience || 'כללי'}".

זהה עד ${count} מתחרים מרכזיים בשוק הישראלי ובינלאומי הרלוונטיים לנישה זו.

החזר JSON בפורמט זה בלבד:
[
  {
    "name": "שם העסק",
    "domain": "website.com",
    "description": "תיאור קצר של העסק",
    "main_offering": "מה הם מוכרים",
    "key_message": "המסר השיווקי המרכזי שלהם",
    "platforms": ["website", "facebook", "instagram"],
    "strength": "strong|medium|weak",
    "confidence": 75
  }
]

כלול רק מתחרים עם confidence >= 60. לפחות 3 מתחרים.`;

  const raw  = await callClaude(apiKey, model, system, prompt, 2500);
  const list = parseJson(raw);
  if (!Array.isArray(list)) return [];
  return list.slice(0, count).map(e => ({
    name:         e.name || 'מתחרה',
    primary_domain: e.domain || '',
    description:  e.description || '',
    main_offering: e.main_offering || '',
    key_message:  e.key_message || '',
    platforms:    Array.isArray(e.platforms) ? e.platforms : ['website'],
    confidence_score: Number(e.confidence) || 70,
    priority:     e.strength === 'strong' ? 'high' : e.strength === 'medium' ? 'medium' : 'low',
    score:        e.strength === 'strong' ? 85 : e.strength === 'medium' ? 65 : 40,
    raw_data:     e,
  }));
}

// ── Competitor Expansion ───────────────────────────────────────────────────────
async function expandCompetitors({ apiKey, model, competitors, niche, plan }) {
  if (!competitors.length || !plan.canSpendExpansion) return competitors;
  const system = 'אתה חוקר שוק מומחה. החזר JSON בלבד.';
  const names  = competitors.slice(0, Math.min(competitors.length, 5)).map(c => c.name).join(', ');
  const prompt = `עבור המתחרים הבאים בנישת "${niche}": ${names}

לכל מתחרה, הרחב את המידע:
- מסרים שיווקיים נוספים
- פלטפורמות שהם פעילים בהן
- סוג הצעות וקריאות לפעולה
- נקודות חוזק ייחודיות

החזר JSON:
[{"name":"שם","ads_messages":["מסר1","מסר2"],"cta_types":["הצעה חינם","קנה עכשיו"],"unique_strengths":["חוזק1"]}]`;

  const raw  = await callClaude(apiKey, model, system, prompt, 2000);
  const expansions = parseJson(raw);
  if (!Array.isArray(expansions)) return competitors;
  const expMap = {};
  expansions.forEach(e => { if (e.name) expMap[e.name.toLowerCase()] = e; });
  return competitors.map(c => {
    const exp = expMap[c.name.toLowerCase()] || {};
    return { ...c, raw_data: { ...c.raw_data, ...exp } };
  });
}

// ── Avatar Signal Collection ───────────────────────────────────────────────────
async function collectAvatarSignals({ apiKey, model, niche, targetAudience, plan }) {
  const system = 'אתה פסיכולוג שיווקי מומחה. מחקר עמוק של קהל יעד. החזר JSON בלבד.';
  const segmentCount = plan.maxSegments;
  const prompt = `בצע מחקר אווטר מעמיק עבור קהל היעד של נישת: "${niche}".
קהל יעד: "${targetAudience || 'לא צוין'}".

אסוף עד ${plan.maxSignals} אותות (signals) מהסוגים הבאים:
- כאבים (pain): בעיות שהם חיים איתן
- פחדים (fear): מה הם חוששים שיקרה
- רצונות (desire): מה הם רוצים להשיג
- תסכולים (frustration): מה מרגיז אותם
- טריגרים (trigger): מה גורם להם לפעול
- דפוסי שפה (language): ביטויים שהם משתמשים בהם בפועל

עד ${segmentCount} סגמנטים של קהל.

החזר JSON:
{
  "segments": ["שם סגמנט 1", "שם סגמנט 2"],
  "signals": [
    {
      "type": "pain|fear|desire|frustration|trigger|language",
      "text": "הביטוי או הכאב עצמו",
      "context": "הקשר נוסף",
      "frequency": 3,
      "confidence": 80,
      "segment": "שם הסגמנט"
    }
  ]
}`;

  const raw  = await callClaude(apiKey, model, system, prompt, 3000);
  const data = parseJson(raw);
  if (!data || !Array.isArray(data.signals)) return { segments: [], signals: [] };
  const cleaned = filterSignals(data.signals.slice(0, plan.maxSignals));
  return { segments: data.segments || [], signals: cleaned };
}

// ── Ads Intelligence ───────────────────────────────────────────────────────────
async function collectAdsIntelligence({ apiKey, model, niche, competitors, plan }) {
  const system = 'אתה מומחה לפרסום דיגיטלי. מחקר מודעות. החזר JSON בלבד.';
  const topCompetitors = competitors.slice(0, 3).map(c => c.name).join(', ');
  const prompt = `נתח את המודעות הפרסומיות הנפוצות בנישת "${niche}".
מתחרים מרכזיים: ${topCompetitors}.

זהה:
1. סוגי הצעות (offers) שחוזרים במודעות
2. זוויות מכירה (angles) נפוצות
3. מסרים שנראים עובדים (מודעות שרצות זמן רב)
4. קריאות לפעולה (CTAs) נפוצות
5. פורמטים שעובדים (וידאו/תמונה/carousel)

החזר JSON:
{
  "common_offers": ["הצעה1","הצעה2"],
  "winning_angles": ["זווית1","זווית2"],
  "dominant_messages": ["מסר1","מסר2"],
  "top_ctas": ["CTA1","CTA2"],
  "best_formats": ["format1"],
  "ad_insights": "תובנה כללית על הפרסומות בנישה"
}`;

  const raw  = await callClaude(apiKey, model, system, prompt, 1500);
  return parseJson(raw) || {};
}

module.exports = {
  discoverCompetitors,
  expandCompetitors,
  collectAvatarSignals,
  collectAdsIntelligence,
};
