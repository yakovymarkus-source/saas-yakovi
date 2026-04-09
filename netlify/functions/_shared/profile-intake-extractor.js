'use strict';

/**
 * profile-intake-extractor.js — Business Profile Intake Extraction (Layer 27)
 *
 * Stateless, pure extraction. Zero DB calls.
 *
 * When the user is in the 'business' chat flow and their message looks like an
 * answer to a missing profile question, this module extracts a typed value.
 *
 * Design rules:
 *   - Only extracts ONE field per message (the top missing field)
 *   - Conservative: returns null rather than a false positive
 *   - For free-text fields (offer, audience...) extracts only when message is
 *     short (<= 200 chars) and clearly an answer, not a question
 *   - For structured fields (price, goal, model) applies keyword/regex matching
 *
 * Usage:
 *   const extracted = extractProfileAnswer(message, missingRequired, missingEnrichment);
 *   // { field: 'price_amount', value: 499 } | null
 */

// ── Helpers ───────────────────────────────────────────────────────────────────

function isQuestion(text) {
  return text.trim().endsWith('?') || /^מ[הי]|^מתי|^למה|^איך|^מה|^האם|^כמה/i.test(text.trim());
}

function stripPrefixes(text) {
  // Remove common answer prefixes before the actual value
  return text
    .replace(/^(אני\s+)?(מוכר|מציע|עוזר\s+ל|פותר)\s*/i, '')
    .replace(/^(הבעיה\s+(היא|שלי|של|ה)?\s*[:\-]?\s*)/i, '')
    .replace(/^(התוצאה\s+(היא|שלי|של|ה)?\s*[:\-]?\s*)/i, '')
    .replace(/^(הקהל\s+(שלי|יעד|הוא)?\s*[:\-]?\s*)/i, '')
    .replace(/^(הייחוד\s+(שלי|הוא)?\s*[:\-]?\s*)/i, '')
    .replace(/^(ההבטחה\s+(שלי|הוא)?\s*[:\-]?\s*)/i, '')
    .replace(/^(שם\s+(העסק|שלי)\s*[:\-]?\s*)/i, '')
    .trim();
}

// ── Structured extractors ─────────────────────────────────────────────────────

function extractPrice(text) {
  // Matches: 499, 1,500, ₪499, 499 שקל, 499.00
  const m = text.match(/(\d[\d,.]*)[\s]*(₪|שקל|ש"ח|ils|nis|\$|usd|€|eur)?/i);
  if (!m) return null;
  const num = parseFloat(m[1].replace(/,/g, ''));
  return (!isNaN(num) && num > 0) ? num : null;
}

// W = word boundary that works for both Hebrew and ASCII
// Hebrew chars are not \w in JS regex, so \b fails. We match after space/start and before space/end/punctuation.
const W = '(?:^|[\\s,;!?.()])';
const E = '(?:[\\s,;!?.()"\'\\-]|$)';
function hw(pattern) { return new RegExp(`(?:${W})(${pattern})(?=${E})`, 'i'); }

function extractGoal(text) {
  if (hw('לידים?|ליד').test(text) || /\bleads?\b/i.test(text))                   return 'leads';
  if (hw('מכירות?|מכירה|רכישה').test(text) || /\bsales?\b/i.test(text))          return 'sales';
  if (hw('פגישות?|פגישה|ייעוץ').test(text) || /\bappointments?\b/i.test(text))   return 'appointments';
  if (hw('מודעות?|חשיפה').test(text) || /\b(awareness|brand)\b/i.test(text))     return 'awareness';
  return null;
}

function extractCategory(text) {
  if (hw('חנות|מוצר').test(text) || /\b(ecommerce|shop|store|product)\b/i.test(text)) return 'ecommerce';
  if (hw('קורס|הכשרה|הדרכה|סדנה').test(text) || /\b(course|workshop)\b/i.test(text))  return 'course';
  if (hw('תוכנה|אפליקציה|פלטפורמה').test(text) || /\b(saas|software|app)\b/i.test(text)) return 'saas';
  if (hw('לידים|ליד').test(text) || /\blead.?gen/i.test(text))                          return 'lead_generation';
  if (hw('שירות|ייעוץ|טיפול|מאמן').test(text) || /\b(service|consult|coach)\b/i.test(text)) return 'services';
  return null;
}

function extractPricingModel(text) {
  // Check more specific terms first to avoid false positives
  if (hw('ריטיינר').test(text) || /\bretainer\b/i.test(text))                                 return 'retainer';
  if (hw('חד.?פעמי').test(text) || /\bone.?time\b/i.test(text))                               return 'one_time';
  if (hw('לפגישה|שעתי').test(text) || /\b(per.?session|hourly)\b/i.test(text))                return 'session';
  if (hw('חודשי|מנוי|חוזר').test(text) || /\b(monthly|subscription|recurring)\b/i.test(text)) return 'recurring';
  if (hw('חינם').test(text) || /\bfree\b/i.test(text))                                        return 'free';
  return null;
}

// ── Free-text extractor ───────────────────────────────────────────────────────
// Used for: offer, target_audience, problem_solved, desired_outcome,
//           unique_mechanism, main_promise, business_name

function extractFreeText(text) {
  if (isQuestion(text)) return null;                    // don't capture questions
  if (text.length > 200) return null;                   // too long = not a direct answer
  const cleaned = stripPrefixes(text);
  return cleaned.length >= 3 ? cleaned : null;
}

// ── Field dispatcher ──────────────────────────────────────────────────────────

const FIELD_EXTRACTORS = {
  offer:            (t) => extractFreeText(t),
  price_amount:     (t) => extractPrice(t),
  target_audience:  (t) => extractFreeText(t),
  problem_solved:   (t) => extractFreeText(t),
  desired_outcome:  (t) => extractFreeText(t),
  primary_goal:     (t) => extractGoal(t),
  business_name:    (t) => extractFreeText(t),
  category:         (t) => extractCategory(t),
  pricing_model:    (t) => extractPricingModel(t),
  unique_mechanism: (t) => extractFreeText(t),
  main_promise:     (t) => extractFreeText(t),
  monthly_budget:   (t) => extractPrice(t),
  test_budget:      (t) => extractPrice(t),
};

// ── Confirmation labels ───────────────────────────────────────────────────────

const CONFIRMATION_LABELS = {
  offer:            'מה אתה מוכר',
  price_amount:     'מחיר',
  target_audience:  'קהל יעד',
  problem_solved:   'בעיה שפותרים',
  desired_outcome:  'תוצאה שהלקוח מקבל',
  primary_goal:     'מטרת הקמפיין',
  business_name:    'שם העסק',
  category:         'קטגוריה',
  pricing_model:    'מודל תמחור',
  unique_mechanism: 'מנגנון ייחודי',
  main_promise:     'הבטחה מרכזית',
  monthly_budget:   'תקציב חודשי',
  test_budget:      'תקציב בדיקה',
};

const GOAL_LABELS = {
  leads: 'איסוף לידים', sales: 'מכירות ישירות',
  appointments: 'קביעת פגישות', awareness: 'מודעות מותג',
};
const CATEGORY_LABELS = {
  ecommerce: 'חנות / מוצרים', services: 'שירותים / ייעוץ',
  lead_generation: 'לידים', course: 'קורס / הכשרה',
  saas: 'SaaS / תוכנה', other: 'אחר',
};
const MODEL_LABELS = {
  one_time: 'חד פעמי', recurring: 'חוזר / מנוי',
  session: 'לפי שעה', retainer: 'ריטיינר', free: 'חינם',
};

function formatValue(field, value) {
  if (field === 'price_amount' || field === 'monthly_budget' || field === 'test_budget') return `₪${value}`;
  if (field === 'primary_goal')   return GOAL_LABELS[value]     || value;
  if (field === 'category')       return CATEGORY_LABELS[value] || value;
  if (field === 'pricing_model')  return MODEL_LABELS[value]    || value;
  return value;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * extractProfileAnswer(message, missingRequired, missingEnrichment)
 *
 * Tries to extract a value for the top missing profile field from the user's message.
 * Returns { field, value, confirmationText } or null.
 *
 * @param {string}   message            — raw user message
 * @param {string[]} missingRequired    — ordered list of required fields still missing
 * @param {string[]} missingEnrichment  — ordered list of enrichment fields still missing
 */
function extractProfileAnswer(message, missingRequired = [], missingEnrichment = []) {
  if (!message || !message.trim()) return null;

  const text = message.trim();

  // Try top missing field first, then continue down the list
  const allMissing = [...missingRequired, ...missingEnrichment];

  for (const field of allMissing) {
    const extractor = FIELD_EXTRACTORS[field];
    if (!extractor) continue;

    const value = extractor(text);
    if (value === null || value === undefined) continue;

    const label = CONFIRMATION_LABELS[field] || field;
    const formatted = formatValue(field, value);

    return {
      field,
      value,
      confirmationText: `✅ שמרתי: **${label}** → ${formatted}`,
    };
  }

  return null;
}

module.exports = {
  extractProfileAnswer,
  // Exposed for testing:
  extractPrice,
  extractGoal,
  extractCategory,
  extractPricingModel,
  extractFreeText,
};
