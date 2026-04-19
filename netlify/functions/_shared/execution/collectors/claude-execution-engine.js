'use strict';
/**
 * execution/collectors/claude-execution-engine.js
 * All AI calls for the Execution Agent.
 * Each function = one focused AI call.
 */

const { callClaude } = require('../../providers/adapters/claude');

const MODEL  = 'claude-haiku-4-5-20251001';
const MODEL_HEAVY = 'claude-sonnet-4-6';

// ── Hooks ─────────────────────────────────────────────────────────────────────
async function generateHooks({ brief, messageCore, awarenessProfile, decisionProfile, variantInstructions }) {
  const { selectedPain, coreMessage, tone, method, targetCustomer } = brief;
  const count = decisionProfile?.depthProfile?.hookCount || 3;
  const hookApproach = awarenessProfile?.behavior?.hookApproach || 'pain_agitation';
  const toneKey      = tone?.tone || 'direct';

  const prompt = `אתה מומחה לכתיבת hooks שיווקיים בעברית.

הקשר:
- כאב: ${selectedPain}
- מסר מרכזי: ${coreMessage}
- קהל יעד: ${targetCustomer}
- גישת hook: ${hookApproach}
- טון: ${toneKey}
- רמת מודעות: ${awarenessProfile?.level || 'problem_aware'} (${awarenessProfile?.behavior?.label || ''})
- שיטת שיווק: ${method?.primary?.method || 'direct_response'}
${variantInstructions?.avoidInstruction ? `\nאל תשתמש ב: ${variantInstructions.avoidInstruction}` : ''}
${variantInstructions?.openingInstruction ? `\nהוראת פתיחה: ${variantInstructions.openingInstruction}` : ''}

כתוב בדיוק ${count} hooks. כל hook: 1-2 משפטים, לא יותר מ-15 מילים.
החזר JSON בלבד:
{
  "hooks": [
    { "text": "...", "type": "pain/curiosity/story/stat/contrast", "approach": "..." },
    ...
  ]
}`;

  const result = await callClaude({ model: MODEL, prompt, maxTokens: 600 });
  return _parseJSON(result, { hooks: [] });
}

// ── Ad Copy ───────────────────────────────────────────────────────────────────
async function generateAdCopy({ brief, messageCore, offer, awarenessProfile, decisionProfile, hooks, variantInstructions }) {
  const { selectedPain, platform, tone } = brief;
  const behavior  = awarenessProfile?.behavior || {};
  const intensity = decisionProfile?.intensity || 3;
  const charLimit = decisionProfile?.assetRouting?.ads?.charLimit || 125;
  const hook      = hooks?.[0]?.text || messageCore?.headline || selectedPain;

  const prompt = `אתה מומחה לכתיבת מודעות פרסום בעברית ל-${platform}.

הקשר:
- Hook: ${hook}
- כאב: ${selectedPain}
- מסר: ${messageCore?.corePromise?.transformation || ''}
- CTA: ${offer?.mainOfferLine || messageCore?.primaryCta || 'גלה עוד'}
- טון: ${tone?.tone || 'direct'}
- עוצמה (1-5): ${intensity}
- גישת פתיחה: ${behavior.openingLine || 'pain_statement'}
- סוג נחיתה: ${behavior.landingFocus || 'solution_differentiation'}
- גבול תווים לגוף: ${charLimit}
${variantInstructions?.differentiatorNote || ''}
${variantInstructions?.toneInstruction || ''}

כתוב מודעה מלאה. החזר JSON בלבד:
{
  "headline": "...",
  "primary_text": "...",
  "description": "...",
  "cta_button": "...",
  "hook_used": "...",
  "character_count": 0
}`;

  const result = await callClaude({ model: MODEL, prompt, maxTokens: 700 });
  return _parseJSON(result, { headline: '', primary_text: '', cta_button: '', description: '' });
}

// ── Landing Page ──────────────────────────────────────────────────────────────
async function generateLandingPage({ brief, messageCore, offer, awarenessProfile, decisionProfile }) {
  const { selectedPain, productName, productType, targetCustomer } = brief;
  const sections  = decisionProfile?.assetRouting?.landing_page?.sections || ['hero','pain_block','solution','proof','offer','cta'];
  const intensity = decisionProfile?.intensity || 3;

  const prompt = `אתה מומחה ל-landing pages בעברית.

הקשר:
- מוצר: ${productName || productType}
- כאב: ${selectedPain}
- קהל: ${targetCustomer}
- הצעה: ${offer?.coreOffer?.headline || ''}
- ערבות: ${offer?.guaranteeLine || ''}
- דחיפות: ${offer?.urgencyLine || ''}
- ערך מוצר: ${(offer?.valueStack?.items || []).join(', ')}
- מסר מרכזי: ${messageCore?.corePromise?.transformation || ''}
- proof points: ${messageCore?.proofPoints?.map(p => p.text).join('; ') || ''}
- Objection handlers: ${messageCore?.objectionHandlers?.map(o => `"${o.obj}" → "${o.handler}"`).join('; ') || ''}
- סקציות נדרשות: ${sections.join(', ')}
- עוצמה: ${intensity}/5

כתוב תוכן לכל סקציה. החזר JSON:
{
  "sections": {
    "hero":        { "headline": "...", "subheadline": "...", "cta": "..." },
    "pain_block":  { "headline": "...", "body": "..." },
    "solution":    { "headline": "...", "body": "...", "mechanism": "..." },
    "proof":       { "headline": "...", "testimonial_placeholder": "...", "stat": "..." },
    "offer":       { "headline": "...", "value_stack": ["..."], "price_anchor": "...", "guarantee": "..." },
    "faq":         { "questions": [{ "q": "...", "a": "..." }] },
    "cta":         { "headline": "...", "button": "...", "urgency": "..." }
  },
  "tracking_events": ["PageView","Lead","Purchase","InitiateCheckout"]
}`;

  const result = await callClaude({ model: MODEL_HEAVY, prompt, maxTokens: 2000 });
  return _parseJSON(result, { sections: {}, tracking_events: [] });
}

// ── Video/Reel Script ─────────────────────────────────────────────────────────
async function generateScript({ brief, messageCore, offer, awarenessProfile, decisionProfile }) {
  const { selectedPain, platform, tone, targetCustomer } = brief;
  const durationSecs = decisionProfile?.assetRouting?.scripts?.durationSecs || 60;
  const hookApproach = awarenessProfile?.behavior?.hookApproach || 'pain_agitation';

  const prompt = `אתה מומחה לכתיבת סקריפטים לסרטונים קצרים בעברית.

פלטפורמה: ${platform}
משך: ${durationSecs} שניות
כאב: ${selectedPain}
קהל: ${targetCustomer}
גישת hook: ${hookApproach}
מסר: ${messageCore?.headline || ''}
CTA: ${offer?.mainOfferLine || ''}

כתוב סקריפט מלא עם טיימינג. החזר JSON:
{
  "hook":         { "text": "...", "duration_sec": 3 },
  "problem":      { "text": "...", "duration_sec": 10 },
  "solution":     { "text": "...", "duration_sec": 20 },
  "proof":        { "text": "...", "duration_sec": 15 },
  "cta":          { "text": "...", "duration_sec": 7 },
  "total_sec":    55,
  "visual_notes": "...",
  "caption":      "..."
}`;

  const result = await callClaude({ model: MODEL, prompt, maxTokens: 1000 });
  return _parseJSON(result, { hook: {}, problem: {}, solution: {}, proof: {}, cta: {} });
}

// ── Email ─────────────────────────────────────────────────────────────────────
async function generateEmail({ brief, messageCore, offer, awarenessProfile, decisionProfile, emailIndex }) {
  const { selectedPain, productName, targetCustomer, tone } = brief;
  const sequenceLength = decisionProfile?.assetRouting?.email?.sequenceLength || 3;
  const emailSeq       = awarenessProfile?.behavior?.emailSequence || 'solution_education';
  const index          = emailIndex || 0;

  const EMAIL_PURPOSES = {
    awareness_nurture:    ['ברוכים הבאים + סיפור', 'חינוך — הבעיה', 'פתרון + הצעה'],
    solution_education:   ['הבעיה + הפתרון', 'איך זה עובד', 'הצעה + ערבות'],
    objection_handling:   ['לנהל התנגדויות — שאלה 1', 'להתגבר על חשש', 'הצעה אחרונה'],
    conversion_push:      ['תזכורת + דחיפות', 'הטבה מיוחדת', 'הזדמנות אחרונה'],
  };
  const purposes = EMAIL_PURPOSES[emailSeq] || EMAIL_SEQUENCES.solution_education;
  const purpose  = purposes[Math.min(index, purposes.length - 1)] || 'follow-up כללי';

  const prompt = `אתה מומחה לכתיבת אימיילים שיווקיים בעברית.

אימייל ${index + 1}/${sequenceLength} בסדרה: "${emailSeq}"
מטרה: ${purpose}
כאב: ${selectedPain}
קהל: ${targetCustomer}
מוצר: ${productName || ''}
מסר: ${messageCore?.headline || ''}
הצעה: ${offer?.mainOfferLine || ''}
ערבות: ${offer?.guaranteeLine || ''}
טון: ${tone?.tone || 'direct'}

כתוב אימייל מלא. החזר JSON:
{
  "subject":    "...",
  "preview":    "...",
  "greeting":   "...",
  "body":       "...",
  "cta_text":   "...",
  "ps_line":    "...",
  "word_count": 0
}`;

  const result = await callClaude({ model: MODEL, prompt, maxTokens: 900 });
  return _parseJSON(result, { subject: '', body: '', cta_text: '' });
}

// ── Visual Concept ────────────────────────────────────────────────────────────
async function generateVisualConcept({ brief, messageCore, awarenessProfile, assetType }) {
  const { platform, tone, selectedPain, productType } = brief;

  const prompt = `אתה מנהל קריאייטיב שכותב briefים ויזואליים לצוות עיצוב.

פלטפורמה: ${platform}
סוג נכס: ${assetType}
כאב: ${selectedPain}
טון: ${tone?.tone || 'direct'}
רמת מודעות: ${awarenessProfile?.level || 'problem_aware'}
מסר: ${messageCore?.headline || ''}
סוג מוצר: ${productType}

כתוב brief ויזואלי מפורט. החזר JSON:
{
  "visual_concept":     "...",
  "color_direction":    "...",
  "imagery_type":       "person/product/abstract/lifestyle",
  "text_on_image":      "...",
  "emotion_to_convey":  "...",
  "format_notes":       "...",
  "do_list":            ["..."],
  "dont_list":          ["..."]
}`;

  const result = await callClaude({ model: MODEL, prompt, maxTokens: 700 });
  return _parseJSON(result, { visual_concept: '', color_direction: '', imagery_type: '' });
}

// ── CTA Variants ──────────────────────────────────────────────────────────────
async function generateCTA({ brief, messageCore, offer, awarenessProfile, count }) {
  const ctaStrength = awarenessProfile?.behavior?.ctaStrength || 'medium';
  const { productType, tone } = brief;

  const prompt = `אתה מומחה ל-CTA בעברית.

עוצמת CTA: ${ctaStrength}
סוג המרה: ${offer?.conversionMethod || 'free_consultation'}
סוג מוצר: ${productType}
טון: ${tone?.tone || 'direct'}
דחיפות: ${offer?.urgencyLine || ''}

כתוב ${count || 3} גרסאות CTA שונות בסגנון ועוצמה.
החזר JSON:
{
  "ctas": [
    { "text": "...", "style": "soft/medium/urgent", "character_count": 0 },
    ...
  ]
}`;

  const result = await callClaude({ model: MODEL, prompt, maxTokens: 400 });
  return _parseJSON(result, { ctas: [] });
}

// ── Self-Feedback (quality pass) ──────────────────────────────────────────────
async function generateSelfFeedback({ assets, brief, messageCore }) {
  const assetSummary = Object.entries(assets || {}).map(([k, v]) => {
    const sample = Array.isArray(v) ? v[0] : v;
    return `${k}: ${JSON.stringify(sample).slice(0, 200)}`;
  }).join('\n');

  const prompt = `אתה מנהל קריאייטיב בכיר שמבצע quality check על נכסים שיווקיים.

נכסים שנוצרו:
${assetSummary}

הקשר:
- כאב: ${brief.selectedPain}
- מסר מרכזי: ${messageCore?.headline || ''}
- CTA מצופה: ${messageCore?.primaryCta || ''}

בצע quality check ב-5 קטגוריות. החזר JSON:
{
  "scores": {
    "message_clarity":  0,
    "pain_resonance":   0,
    "cta_strength":     0,
    "tone_consistency": 0,
    "uniqueness":       0
  },
  "overall_score":   0,
  "top_issue":       "...",
  "quick_win":       "...",
  "approved":        true
}`;

  const result = await callClaude({ model: MODEL, prompt, maxTokens: 600 });
  return _parseJSON(result, { scores: {}, overall_score: 0, approved: false });
}

// ── Decision Explanation ──────────────────────────────────────────────────────
async function generateDecisionExplanation({ brief, decisionProfile, awarenessProfile, consistencyResult }) {
  const prompt = `אתה מסביר למשתמש את ההחלטות השיווקיות שנלקחו.

הקשר:
- מצב קהל: ${awarenessProfile?.behavior?.label || ''}
- עוצמה: ${decisionProfile?.intensity}/5
- מצב ביצוע: ${brief.executionMode}
- בעיות שזוהו: ${consistencyResult?.issues?.map(i => i.message).join('; ') || 'אין'}

כתוב הסבר קצר (3-4 משפטים) בעברית נגישה למה נבחרו האפשרויות האלה.
החזר JSON:
{
  "explanation":    "...",
  "key_decision":   "...",
  "why_it_works":   "...",
  "watch_out_for":  "..."
}`;

  const result = await callClaude({ model: MODEL, prompt, maxTokens: 400 });
  return _parseJSON(result, { explanation: '', key_decision: '', why_it_works: '' });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function _parseJSON(raw, fallback) {
  try {
    const match = (typeof raw === 'string' ? raw : '').match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    if (typeof raw === 'object' && raw !== null) return raw;
  } catch (_) {}
  return fallback;
}

module.exports = {
  generateHooks,
  generateAdCopy,
  generateLandingPage,
  generateScript,
  generateEmail,
  generateVisualConcept,
  generateCTA,
  generateSelfFeedback,
  generateDecisionExplanation,
};
