'use strict';
/**
 * execution/core/offer-builder.js
 * Builds offer structure if missing from strategy report.
 * Pure logic — no AI calls.
 */

function buildOffer(brief, awarenessProfile) {
  const {
    productType, productName, outcome, funnel,
    method, tone, viabilityScore, kpi, targetCustomer,
  } = brief;

  const conversionMethod = funnel?.conversion_method || 'free_consultation';
  const trustBuilder     = funnel?.trust_builder     || '';
  const offerStructure   = funnel?.offer_structure   || '';
  const hookStrategy     = funnel?.hook_strategy     || 'problem';

  // ── Core Offer ────────────────────────────────────────────────────────────
  const coreOffer = _buildCoreOffer({ productType, productName, outcome, conversionMethod });

  // ── Value Stack ───────────────────────────────────────────────────────────
  const valueStack = _buildValueStack({ productType, outcome, offerStructure });

  // ── Risk Reversal (guarantee) ─────────────────────────────────────────────
  const riskReversal = _buildRiskReversal({ productType, viabilityScore });

  // ── Urgency / Scarcity ────────────────────────────────────────────────────
  const urgency = _buildUrgency({ awarenessProfile, method });

  // ── Trust Signals ─────────────────────────────────────────────────────────
  const trustSignals = _buildTrustSignals({ trustBuilder, productType });

  // ── Price Anchoring ───────────────────────────────────────────────────────
  const priceAnchoring = _buildPriceAnchoring({ productType, kpi });

  return {
    coreOffer,
    valueStack,
    riskReversal,
    urgency,
    trustSignals,
    priceAnchoring,
    conversionMethod,
    hookStrategy,
    // Flat helpers for asset generators
    mainOfferLine:    coreOffer.headline,
    guaranteeLine:    riskReversal.line,
    urgencyLine:      urgency.line,
  };
}

// ── Builders ──────────────────────────────────────────────────────────────────

function _buildCoreOffer({ productType, productName, outcome, conversionMethod }) {
  const name = productName || _defaultProductName(productType);
  const headlines = {
    free_consultation: `שיחת ייעוץ חינם עם ${name}`,
    free_content:      `המדריך החינמי: ${outcome || 'איך להגיע לתוצאות'}`,
    direct_sale:       `${name} — ${outcome || 'מערכת מוכחת לתוצאות'}`,
    waitlist:          `הצטרף ל-${name} — מקומות מוגבלים`,
    webinar:           `וובינר חינמי: ${outcome || 'גלה את הסוד'}`,
  };
  return {
    name,
    headline:      headlines[conversionMethod] || name,
    conversionType: conversionMethod,
    primaryBenefit: outcome || '',
  };
}

function _buildValueStack({ productType, outcome, offerStructure }) {
  const defaults = {
    course:   ['מודולים מוקלטים', 'קהילת תמיכה', 'תעודת סיום', 'שאלות ותשובות חי'],
    coaching: ['מפגשים אישיים', 'ליווי בין מפגשים', 'כלים ותבניות', 'גישה לחומרים'],
    saas:     ['גישה לפלטפורמה', 'אינטגרציות', 'תמיכה 24/7', 'עדכונים אוטומטיים'],
    default:  ['גישה מיידית', 'תמיכה מלאה', 'תוצאות מוכחות', 'ערבות שביעות רצון'],
  };
  const items = offerStructure
    ? (typeof offerStructure === 'string' ? offerStructure.split(',').map(s => s.trim()) : offerStructure)
    : (defaults[productType] || defaults.default);
  return { items, count: items.length };
}

function _buildRiskReversal({ productType, viabilityScore }) {
  const guarantees = {
    course:   'ערבות החזר כסף מלאה תוך 30 יום',
    coaching: 'אם לא תראה תוצאות אחרי 60 יום — שיחה חינם נוספת',
    saas:     'ניסיון חינם 14 יום — ללא כרטיס אשראי',
    default:  'ערבות שביעות רצון מלאה',
  };
  const line = guarantees[productType] || guarantees.default;
  return {
    line,
    strength: viabilityScore >= 70 ? 'strong' : 'standard',
    type:     'money_back',
  };
}

function _buildUrgency({ awarenessProfile, method }) {
  if (awarenessProfile?.index <= 1) {
    return { type: 'soft', line: 'מקומות מוגבלים — הצטרף בחינם', active: false };
  }
  const methodKey = method?.primary?.method || '';
  if (methodKey === 'direct_response') {
    return { type: 'strong', line: 'המחיר עולה בחצות הלילה', active: true };
  }
  return { type: 'medium', line: 'מקומות מוגבלים — שמור מקום עכשיו', active: true };
}

function _buildTrustSignals({ trustBuilder, productType }) {
  const TRUST_TYPES = {
    testimonials:  { label: 'ביקורות לקוחות', icon: '⭐' },
    case_study:    { label: 'סטאדי קייסים', icon: '📊' },
    stats:         { label: 'מספרים ונתונים', icon: '📈' },
    credentials:   { label: 'תעודות והסמכות', icon: '🏆' },
    media:         { label: 'כיסוי תקשורתי', icon: '📰' },
    social_proof:  { label: 'הוכחה חברתית', icon: '👥' },
  };
  const key = trustBuilder || 'testimonials';
  const primary = TRUST_TYPES[key] || TRUST_TYPES.testimonials;
  const secondary = productType === 'saas' ? TRUST_TYPES.stats : TRUST_TYPES.testimonials;
  return { primary, secondary, key };
}

function _buildPriceAnchoring({ productType, kpi }) {
  const ANCHOR_TEMPLATES = {
    course:   { anchor: '₪3,000', offer: '₪997', saving: '₪2,003' },
    coaching: { anchor: '₪10,000', offer: '₪3,500', saving: '₪6,500' },
    saas:     { anchor: '₪500/חודש', offer: '₪197/חודש', saving: '60%' },
    default:  { anchor: null, offer: null, saving: null },
  };
  return ANCHOR_TEMPLATES[productType] || ANCHOR_TEMPLATES.default;
}

function _defaultProductName(productType) {
  const names = { course: 'הקורס', coaching: 'תוכנית הליווי', saas: 'הפלטפורמה', default: 'המוצר' };
  return names[productType] || names.default;
}

module.exports = { buildOffer };
