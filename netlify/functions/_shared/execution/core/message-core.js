'use strict';
/**
 * execution/core/message-core.js
 * Message Core Builder + Message Hierarchy.
 * Pure logic — no AI calls.
 * Outputs the structured message hierarchy used by all asset generators.
 */

/**
 * Message Hierarchy:
 *   Level 1 — Core Promise (the transformation)
 *   Level 2 — Main Pain (the trigger)
 *   Level 3 — Proof Points (3 supporting claims)
 *   Level 4 — Objection Handlers (top 2 objections)
 *   Level 5 — CTA Direction (what we want them to do)
 */

function buildMessageCore(brief) {
  const {
    selectedPain, outcome, coreMessage, angles,
    positioning, whyUs, method, tone, funnel,
    targetCustomer, productType, productName,
    hypotheses, confidence,
  } = brief;

  // ── Level 1: Core Promise ─────────────────────────────────────────────────
  const corePromise = _buildCorePromise({ outcome, coreMessage, productType });

  // ── Level 2: Main Pain ────────────────────────────────────────────────────
  const mainPain = _buildMainPain({ selectedPain, targetCustomer });

  // ── Level 3: Proof Points ─────────────────────────────────────────────────
  const proofPoints = _buildProofPoints({ angles, whyUs, hypotheses, confidence });

  // ── Level 4: Objection Handlers ───────────────────────────────────────────
  const objectionHandlers = _buildObjectionHandlers({ productType, method, positioning });

  // ── Level 5: CTA Direction ────────────────────────────────────────────────
  const ctaDirection = _buildCtaDirection({ funnel, method, productType });

  // ── Tone Profile ──────────────────────────────────────────────────────────
  const toneProfile = _buildToneProfile({ tone, method });

  // ── Narrative Arc ─────────────────────────────────────────────────────────
  const narrativeArc = _buildNarrativeArc({ method, funnel, productType });

  // ── Message Hierarchy (Big Idea → Supporting → Micro) ────────────────────
  const messageHierarchy = _buildMessageHierarchy({ corePromise, mainPain, proofPoints, outcome, angles });

  return {
    corePromise,
    mainPain,
    proofPoints,
    objectionHandlers,
    ctaDirection,
    toneProfile,
    narrativeArc,
    messageHierarchy,
    // Convenience flat fields for asset generators
    headline:    corePromise.headline,
    subheadline: corePromise.subheadline,
    painLine:    mainPain.line,
    primaryCta:  ctaDirection.primary,
    bigIdea:     messageHierarchy.bigIdea,
  };
}

// ── Builders ──────────────────────────────────────────────────────────────────

function _buildCorePromise({ outcome, coreMessage, productType }) {
  const transformation = outcome || coreMessage || '';
  return {
    transformation,
    headline:    _transformationToHeadline(transformation, productType),
    subheadline: _transformationToSubheadline(transformation),
    type:        _classifyPromise(transformation),
  };
}

function _buildMainPain({ selectedPain, targetCustomer }) {
  return {
    pain:     selectedPain || '',
    audience: targetCustomer || '',
    line:     selectedPain ? `אם אתה ${targetCustomer || 'יזם'} שמתמודד עם ${selectedPain}` : '',
    trigger:  _painToTrigger(selectedPain),
  };
}

function _buildProofPoints({ angles, whyUs, hypotheses, confidence }) {
  const points = [];
  if (angles && angles.length > 0) {
    angles.slice(0, 3).forEach(a => points.push({ type: 'angle', text: typeof a === 'string' ? a : a.angle || a.text || String(a) }));
  }
  if (whyUs) points.push({ type: 'differentiator', text: whyUs });
  if (hypotheses && hypotheses.length > 0) {
    points.push({ type: 'hypothesis', text: hypotheses[0].description || hypotheses[0] });
  }
  if (confidence >= 70) points.push({ type: 'confidence', text: `אסטרטגיה מאומתת ברמת ביטחון ${confidence}%` });
  return points.slice(0, 4);
}

function _buildObjectionHandlers({ productType, method, positioning }) {
  const objections = [];
  const OBJECTIONS = {
    course:   [{ obj: 'כבר ניסיתי קורסים ולא הצליח', handler: 'זה לא עוד קורס — זה מערכת מוכחת עם תוצאות' },
               { obj: 'אין לי זמן', handler: 'המערכת מותאמת לאנשים עסוקים — 20 דקות ביום מספיקות' }],
    coaching: [{ obj: 'אני לא בטוח שזה מתאים לי', handler: 'מתחילים עם שיחת אבחון חינם — ללא מחויבות' },
               { obj: 'יקר מדי', handler: 'ההשקעה מחזירה את עצמה תוך שבועות ראשונים' }],
    saas:     [{ obj: 'יש כבר פתרונות', handler: 'שום כלי אחר לא עושה X בצורה הזו' },
               { obj: 'מסובך לשלב', handler: 'חיבור בלחיצה אחת — אין צורך בקוד' }],
    default:  [{ obj: 'זה ישר לי?', handler: 'עבד לאלפי לקוחות בדיוק במצבך' },
               { obj: 'מה אם לא יעבוד?', handler: 'ערבות השבת כסף מלאה — ללא שאלות' }],
  };
  return OBJECTIONS[productType] || OBJECTIONS.default;
}

function _buildCtaDirection({ funnel, method, productType }) {
  const conversionMethod = funnel?.conversion_method || '';
  const ctaMap = {
    'free_consultation': { primary: 'קבל שיחת ייעוץ חינם', secondary: 'שמור מקום עכשיו', urgency: 'מקומות מוגבלים' },
    'free_content':      { primary: 'הורד את המדריך החינמי', secondary: 'גלה עוד', urgency: 'חינם לחלוטין' },
    'direct_sale':       { primary: 'הצטרף עכשיו', secondary: 'רכוש היום', urgency: 'מחיר מיוחד לזמן מוגבל' },
    'waitlist':          { primary: 'הצטרף לרשימת המתנה', secondary: 'קבל עדיפות', urgency: 'מקומות ראשונים מוגבלים' },
    'webinar':           { primary: 'הירשם לוובינר החינמי', secondary: 'תפוס מקום', urgency: 'הרישום נסגר בקרוב' },
  };
  return ctaMap[conversionMethod] || { primary: 'גלה עוד', secondary: 'התחל עכשיו', urgency: '' };
}

function _buildToneProfile({ tone, method }) {
  const toneKey  = tone?.tone  || 'direct';
  const methodKey = method?.primary?.method || '';
  const profiles = {
    authority:       { voice: 'expert', formality: 'high',   emotion: 'low',    pace: 'measured' },
    empathetic:      { voice: 'friend', formality: 'low',    emotion: 'high',   pace: 'warm' },
    direct:          { voice: 'peer',   formality: 'medium', emotion: 'medium', pace: 'crisp' },
    inspiring:       { voice: 'coach',  formality: 'medium', emotion: 'high',   pace: 'energetic' },
    educational:     { voice: 'teacher',formality: 'medium', emotion: 'low',    pace: 'clear' },
    conversational:  { voice: 'peer',   formality: 'low',    emotion: 'medium', pace: 'casual' },
  };
  const profile = profiles[toneKey] || profiles.direct;
  return { ...profile, toneKey, methodKey };
}

function _buildNarrativeArc({ method, funnel, productType }) {
  const methodKey = method?.primary?.method || 'direct_response';
  const arcs = {
    emotional_story:   ['hook_emotion', 'relate_pain', 'turning_point', 'solution', 'proof', 'cta'],
    social_proof:      ['hook_result', 'proof_stack', 'mechanism', 'offer', 'guarantee', 'cta'],
    direct_response:   ['hook_problem', 'agitate', 'solution', 'features_benefits', 'cta'],
    educational:       ['hook_curiosity', 'reveal_insight', 'teach', 'apply_to_them', 'offer', 'cta'],
    authority:         ['hook_credentials', 'state_problem', 'unique_mechanism', 'proof', 'offer', 'cta'],
    contrast:          ['hook_before', 'pain_depth', 'bridge', 'after_state', 'how', 'cta'],
  };
  return {
    methodKey,
    steps: arcs[methodKey] || arcs.direct_response,
    hookType: funnel?.hook_strategy || 'problem',
  };
}

function _buildMessageHierarchy({ corePromise, mainPain, proofPoints, outcome, angles }) {
  const bigIdea = corePromise.transformation || outcome || '';

  const supportingPoints = [
    mainPain.pain ? `הבעיה: ${mainPain.pain}` : null,
    ...(proofPoints || []).slice(0, 3).map(p => p.text),
  ].filter(Boolean);

  const microMessages = [
    corePromise.headline,
    mainPain.line,
    ...(angles || []).slice(0, 3).map(a => typeof a === 'string' ? a : a.angle || a.text || String(a)),
  ].filter(Boolean).map(m => m.slice(0, 80));

  return {
    bigIdea,
    supportingPoints,
    microMessages,
    depth: supportingPoints.length >= 3 ? 'full' : supportingPoints.length >= 1 ? 'partial' : 'minimal',
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _transformationToHeadline(transformation, productType) {
  if (!transformation) return '';
  if (transformation.length <= 60) return transformation;
  return transformation.split(/[—\-,]/)[0].trim().slice(0, 70);
}

function _transformationToSubheadline(transformation) {
  if (!transformation) return '';
  const parts = transformation.split(/[—\-,]/);
  return parts.length > 1 ? parts.slice(1).join(' — ').trim().slice(0, 120) : '';
}

function _classifyPromise(transformation) {
  const t = (transformation || '').toLowerCase();
  if (t.includes('תוצאה') || t.includes('הכנסה') || t.includes('מכירות')) return 'result';
  if (t.includes('ללמוד') || t.includes('לדעת') || t.includes('להבין')) return 'knowledge';
  if (t.includes('להרגיש') || t.includes('ביטחון') || t.includes('שלווה')) return 'emotional';
  if (t.includes('חיסכון') || t.includes('זמן') || t.includes('יעיל')) return 'efficiency';
  return 'transformation';
}

function _painToTrigger(pain) {
  if (!pain) return '';
  const p = pain.toLowerCase();
  if (p.includes('כסף') || p.includes('הכנסה')) return 'financial';
  if (p.includes('זמן') || p.includes('עסוק')) return 'time';
  if (p.includes('לקוחות') || p.includes('מכירות')) return 'growth';
  if (p.includes('בדידות') || p.includes('ביטחון')) return 'emotional';
  return 'general';
}

module.exports = { buildMessageCore };
