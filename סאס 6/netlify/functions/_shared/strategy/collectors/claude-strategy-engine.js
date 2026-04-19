'use strict';
/**
 * strategy/collectors/claude-strategy-engine.js
 * All AI calls for the Strategy Agent.
 * Pattern: same callClaude() + parseJson() as research/collectors/claude-collector.js.
 * Each function is one focused call — no mega-prompts.
 */

async function callClaude(apiKey, model, system, user, maxTokens = 2000) {
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), 22000);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`Claude ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
    const data = await res.json();
    return data?.content?.find(b => b.type === 'text')?.text || '';
  } finally { clearTimeout(timer); }
}

function parseJson(raw) {
  const m = raw.match(/```json\s*([\s\S]*?)\s*```/) || raw.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  try { return JSON.parse(m ? m[1] : raw); } catch { return null; }
}

// ── 1. Product Design ─────────────────────────────────────────────────────────
// INPUT: selectedPain, backupPains, competitors, gaps, niche, productType (heuristic)
// OUTPUT: outcome, productType (confirmed), productStructure, viabilityScore (enriched)
async function designProduct({ apiKey, model, selectedPain, backupPains, competitorMessages, gaps, niche, heuristicProductType }) {
  const system = 'אתה אסטרטג מוצר מומחה. החזר JSON בלבד, ללא הסברים.';
  const prompt = `בניית מוצר עבור נישה: "${niche}"

כאב מרכזי שנבחר: "${selectedPain}"
כאבי גיבוי: ${backupPains.map(p => `"${p}"`).join(', ')}
מתחרים מרכזיים: ${competitorMessages.slice(0, 4).map(c => c.name).join(', ')}
פערים בשוק: ${gaps.slice(0, 3).map(g => g.title).join(', ')}
סוג מוצר מוצע: ${heuristicProductType}

הגדר מוצר שמישהו ישלם עליו עכשיו. החלטה חייבת להיות מבוססת ראיות מהנתונים.

החזר JSON:
{
  "outcome": "מצב נוכחי → מצב רצוי (משפט אחד קצר)",
  "product_type": "course|service|coaching|saas",
  "product_name_suggestion": "שם מוצר מוצע",
  "product_structure": [
    { "step": 1, "title": "שם השלב", "description": "מה קורה בשלב הזה" }
  ],
  "time_to_result": "זמן משוער לתוצאה ראשונה",
  "complexity": "low|medium|high",
  "viability_enriched": 0-100,
  "viability_reasoning": "למה המוצר הזה ימכור"
}`;

  const raw  = await callClaude(apiKey, model, system, prompt, 1500);
  const data = parseJson(raw);
  if (!data) throw new Error('designProduct: failed to parse Claude response');
  return data;
}

// ── 2. Positioning Generation ─────────────────────────────────────────────────
// INPUT: competitor messages, gaps, niche, selectedPain, wornOutMessages
// OUTPUT: 2-3 positioning options with scores, selected winner
async function generatePositioning({ apiKey, model, competitorMessages, gaps, niche, selectedPain, wornOutMessages }) {
  const system = 'אתה מומחה בידול שיווקי. החזר JSON בלבד, ללא הסברים.';
  const prompt = `בניית בידול עבור נישה: "${niche}"

כאב מרכזי: "${selectedPain}"
מסרים שחוקים (לא להשתמש): ${wornOutMessages.slice(0, 5).join(' | ')}
מסרי מתחרים: ${competitorMessages.slice(0, 4).map(c => `${c.name}: "${c.messages[0] || ''}"`).join('\n')}
פערים לניצול: ${gaps.slice(0, 3).map(g => g.title).join(' | ')}

צור 2-3 אפשרויות בידול שונות. כל אחת חייבת להיות שונה ממסרי המתחרים.
אפשרויות: שיטה שונה / תוצאה שונה / קהל שונה / מהירות / פשטות

החזר JSON:
{
  "options": [
    {
      "positioning": "משפט הבידול הקצר",
      "angle_type": "method|outcome|audience|speed|simplicity",
      "why_different": "למה זה שונה מהמתחרים",
      "gap_used": "איזה פער משוק משתמשים בו",
      "clarity": 0-100,
      "differentiation": 0-100,
      "relevance": 0-100,
      "market_fit": 0-100
    }
  ],
  "selected_index": 0,
  "why_selected": "למה זה הנבחר"
}`;

  const raw  = await callClaude(apiKey, model, system, prompt, 1500);
  const data = parseJson(raw);
  if (!data?.options?.length) throw new Error('generatePositioning: no options returned');
  return data;
}

// ── 3. Core Message + Angles ──────────────────────────────────────────────────
// INPUT: product, positioning, avatar signals, niche
// OUTPUT: coreMessage (X→Y), targetCustomer, 3-5 angles
async function buildCoreMessage({ apiKey, model, product, positioning, fearSignals, desireSignals, languagePatterns, niche }) {
  const system = 'אתה קופירייטר אסטרטגי. החזר JSON בלבד, ללא הסברים.';
  const prompt = `בניית מסר ליבה עבור:
נישה: "${niche}"
כאב: "${product.selectedPain}"
תוצאה: "${product.outcome}"
בידול: "${positioning.selectedPositioning}"

פחדים של הקהל: ${fearSignals.slice(0, 3).join(' | ')}
רצונות: ${desireSignals.slice(0, 3).join(' | ')}
שפה שמשתמשים בה: ${languagePatterns.slice(0, 3).join(' | ')}

בנה מסר שיווקי שהולך ישר לנקודה.

החזר JSON:
{
  "target_customer": "תיאור לקוח אחד ספציפי (לא קהל)",
  "core_message": "אני מוציא אותך מ-X ל-Y (משפט אחד)",
  "angles": [
    { "type": "pain|fear|outcome|differentiation|social_proof", "text": "זווית שיווקית", "hook": "פתיחה שעוצרת" }
  ],
  "language_to_use": ["מילים ומשפטים מהקהל עצמו"],
  "language_to_avoid": ["מסרים שחוקים לא להשתמש"]
}`;

  const raw  = await callClaude(apiKey, model, system, prompt, 1500);
  const data = parseJson(raw);
  if (!data?.core_message) throw new Error('buildCoreMessage: no core message returned');
  return data;
}

// ── 4. Funnel Architecture ────────────────────────────────────────────────────
// INPUT: product, positioning, method, platform, coreMessage
// OUTPUT: full funnel with all 7 stages filled
async function buildFunnelArchitecture({ apiKey, model, product, positioning, method, platform, coreMessage, niche }) {
  const system = 'אתה אסטרטג משפכי שיווק. החזר JSON בלבד, ללא הסברים.';
  const prompt = `בניית משפך שיווקי עבור:
נישה: "${niche}"
מוצר: ${product.productType} — "${product.outcome}"
בידול: "${positioning.selectedPositioning}"
מסר ליבה: "${coreMessage}"
שיטת שיווק: "${method.primary.label}"
פלטפורמה ראשית: "${platform.primary}"

בנה משפך שלם: זר → לקוח משלם.

החזר JSON:
{
  "traffic_source": "מאיפה מגיעים",
  "hook_strategy": "מה עוצר את הגלילה (משפט ראשון)",
  "content_type": "סרטון / כתבה / carousel / live",
  "trust_builder": "מה בונה אמינות (הוכחה / תוצאות / שיטה)",
  "offer_structure": "מה מציעים ואיך מציגים את זה",
  "conversion_method": "איך סוגרים מכירה",
  "follow_up": "מה קורה אחרי שמישהו לא קנה מייד"
}`;

  const raw  = await callClaude(apiKey, model, system, prompt, 1200);
  const data = parseJson(raw);
  if (!data?.hook_strategy) throw new Error('buildFunnelArchitecture: no funnel returned');
  return data;
}

// ── 5. Test Plan ──────────────────────────────────────────────────────────────
async function buildTestPlan({ apiKey, model, product, positioning, coreMessage, angles, niche }) {
  const system = 'אתה מומחה Growth ו-CRO. החזר JSON בלבד.';
  const prompt = `בניית תכנית בדיקות עבור:
נישה: "${niche}"
כאב ראשי: "${product.selectedPain}"
כאבי גיבוי: ${product.backupPains.join(', ')}
בידול נבחר: "${positioning.selectedPositioning}"
מסר: "${coreMessage}"
זוויות: ${(angles || []).map(a => a.text || a).slice(0, 3).join(' | ')}

בנה 2-3 היפותזות בדיקה ספציפיות.

החזר JSON:
{
  "hypotheses": [
    {
      "id": "test_1",
      "what": "מה בודקים",
      "hypothesis": "אנחנו מאמינים ש...",
      "variant_a": "גרסה A",
      "variant_b": "גרסה B",
      "success_metric": "מדד הצלחה",
      "min_impressions": 2000
    }
  ],
  "test_order": ["test_1", "test_2"],
  "priority_reason": "למה מתחילים עם הבדיקה הזו"
}`;

  const raw  = await callClaude(apiKey, model, system, prompt, 1200);
  const data = parseJson(raw);
  return data || { hypotheses: [], test_order: [] };
}

// ── 6. Reality Check ─────────────────────────────────────────────────────────
async function runRealityCheck({ apiKey, model, product, positioning, coreMessage, niche }) {
  const system = 'אתה מומחה שיווק עם ניסיון של 20 שנה. ענה בכנות מוחלטת. החזר JSON בלבד.';
  const prompt = `בדוק את האסטרטגיה הזו ב-Reality Check:

נישה: "${niche}"
מוצר: ${product.productType} — ${product.outcome}
כאב: "${product.selectedPain}"
בידול: "${positioning.selectedPositioning}"
מסר: "${coreMessage}"
ציון כדאיות: ${product.viabilityScore}/100

שאלת המבחן: האם בן אדם ישלם על זה עכשיו?

החזר JSON:
{
  "will_someone_pay": true|false,
  "confidence": 0-100,
  "reason": "למה כן / למה לא",
  "biggest_risk": "הסיכון הגדול ביותר",
  "must_fix": "מה חייב להשתנות (או null אם הכל בסדר)",
  "go_signal": "אדום|צהוב|ירוק"
}`;

  const raw  = await callClaude(apiKey, model, system, prompt, 800);
  const data = parseJson(raw);
  return data || { will_someone_pay: false, confidence: 0, go_signal: 'אדום', reason: 'לא התקבלה תשובה' };
}

module.exports = { designProduct, generatePositioning, buildCoreMessage, buildFunnelArchitecture, buildTestPlan, runRealityCheck };
