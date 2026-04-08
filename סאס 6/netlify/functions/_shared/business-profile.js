'use strict';

/**
 * business-profile.js — Static Business Memory (Layer 7 / Layer 8)
 *
 * Stores and retrieves the stable facts about the user's business:
 * offer, pricing, audience, positioning, tone, goals.
 *
 * This is the foundation context that all other engines read from.
 * Without it, every analysis is blind to what the business actually sells.
 *
 * Design:
 *   - One row per user (UNIQUE constraint on user_id)
 *   - Users can read/write their own row via RLS
 *   - Admin client used for server-side reads in pipelines
 *   - updateIntelligenceFromProfile() syncs key facts into user_intelligence
 *     so the adaptive layer knows the business type and pricing tier
 */

const { getAdminClient }            = require('./supabase');
const { upsertMemoryEntry }         = require('./user-intelligence');

// ── Field labels (for chat display) ──────────────────────────────────────────

const FIELD_LABELS = {
  business_name:    'שם העסק',
  category:         'קטגוריה',
  offer:            'מה אתה מוכר',
  price_amount:     'מחיר',
  pricing_model:    'מודל תמחור',
  target_audience:  'קהל יעד',
  problem_solved:   'בעיה שפותרים',
  desired_outcome:  'תוצאה שהלקוח מקבל',
  unique_mechanism: 'מנגנון ייחודי',
  main_promise:     'הבטחה מרכזית',
  primary_goal:     'מטרה עיקרית',
  monthly_budget:   'תקציב חודשי',
  test_budget:      'תקציב בדיקה',
};

const CATEGORY_LABELS = {
  ecommerce:        'חנות / מוצרים',
  services:         'שירותים / ייעוץ',
  lead_generation:  'לידים',
  course:           'קורס / הכשרה',
  saas:             'SaaS / תוכנה',
  other:            'אחר',
};

const GOAL_LABELS = {
  leads:        'איסוף לידים',
  sales:        'מכירות ישירות',
  appointments: 'קביעת פגישות',
  awareness:    'מודעות מותג',
};

// ── Completion scoring ────────────────────────────────────────────────────────

// Ordered by importance — earlier fields are more critical
const REQUIRED_FIELDS = [
  'offer', 'price_amount', 'target_audience', 'problem_solved',
  'desired_outcome', 'primary_goal',
];
const ENRICHMENT_FIELDS = [
  'business_name', 'category', 'pricing_model', 'unique_mechanism',
  'main_promise', 'monthly_budget',
];

/**
 * scoreCompletion(profile)
 * Returns { pct: 0-100, missingRequired: string[], missingEnrichment: string[] }
 */
function scoreCompletion(profile) {
  if (!profile) return { pct: 0, missingRequired: [...REQUIRED_FIELDS], missingEnrichment: [...ENRICHMENT_FIELDS] };

  const missingRequired   = REQUIRED_FIELDS.filter(f => !profile[f]);
  const missingEnrichment = ENRICHMENT_FIELDS.filter(f => !profile[f]);

  const requiredScore    = ((REQUIRED_FIELDS.length - missingRequired.length) / REQUIRED_FIELDS.length) * 70;
  const enrichmentScore  = ((ENRICHMENT_FIELDS.length - missingEnrichment.length) / ENRICHMENT_FIELDS.length) * 30;
  const pct              = Math.round(requiredScore + enrichmentScore);

  return { pct, missingRequired, missingEnrichment };
}

// ── Read ──────────────────────────────────────────────────────────────────────

/**
 * loadBusinessProfile(userId)
 * Returns the profile row or null. Never throws.
 */
async function loadBusinessProfile(userId) {
  if (!userId) return null;
  try {
    const { data } = await getAdminClient()
      .from('business_profiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    return data || null;
  } catch (e) {
    console.warn('[business-profile] load failed:', e.message);
    return null;
  }
}

// ── Write ─────────────────────────────────────────────────────────────────────

/**
 * upsertBusinessProfile(userId, fields)
 * Merges partial field updates into the existing profile.
 * Automatically marks completed=true when all required fields are present.
 * Returns the updated profile or null on error.
 */
async function upsertBusinessProfile(userId, fields) {
  if (!userId || !fields || typeof fields !== 'object') return null;

  // Sanitise: only allow known columns
  const ALLOWED = new Set([
    'business_name', 'category', 'offer', 'price_amount', 'price_currency',
    'pricing_model', 'target_audience', 'problem_solved', 'desired_outcome',
    'unique_mechanism', 'main_promise', 'tone_keywords', 'primary_goal',
    'monthly_budget', 'test_budget',
  ]);
  const safe = {};
  for (const [k, v] of Object.entries(fields)) {
    if (ALLOWED.has(k) && v !== undefined) safe[k] = v;
  }
  if (Object.keys(safe).length === 0) return null;

  try {
    // Load existing to merge
    const existing = await loadBusinessProfile(userId);
    const merged   = { ...(existing || {}), ...safe, user_id: userId };

    // Auto-mark completed
    const { missingRequired } = scoreCompletion(merged);
    merged.completed = missingRequired.length === 0;

    const { data, error } = await getAdminClient()
      .from('business_profiles')
      .upsert(merged, { onConflict: 'user_id' })
      .select()
      .maybeSingle();

    if (error) {
      console.warn('[business-profile] upsert failed:', error.message);
      return null;
    }

    // Sync to user_intelligence so adaptive layer knows the business type
    updateIntelligenceFromProfile(userId, data).catch(() => {});

    return data;
  } catch (e) {
    console.warn('[business-profile] upsert exception:', e.message);
    return null;
  }
}

// ── Intelligence sync ─────────────────────────────────────────────────────────

/**
 * updateIntelligenceFromProfile(userId, profile)
 * Syncs business type and pricing tier into user_intelligence.
 * Called fire-and-forget after every profile upsert.
 */
async function updateIntelligenceFromProfile(userId, profile) {
  if (!profile) return;
  try {
    if (profile.category) {
      await upsertMemoryEntry(userId, 'goal', 'business_type', profile.category, 0.95);
    }
    if (profile.price_amount) {
      const tier = profile.price_amount >= 2000 ? 'premium'
                 : profile.price_amount >= 500  ? 'mid'
                 : 'low';
      await upsertMemoryEntry(userId, 'goal', 'pricing_tier', tier, 0.90);
    }
    if (profile.primary_goal) {
      await upsertMemoryEntry(userId, 'goal', 'campaign_goal', profile.primary_goal, 0.90);
    }
  } catch (e) {
    console.warn('[business-profile] intelligence sync failed:', e.message);
  }
}

// ── Chat helpers ──────────────────────────────────────────────────────────────

/**
 * formatProfileSummary(profile)
 * Returns a short Hebrew summary string for use in chat responses.
 */
function formatProfileSummary(profile) {
  if (!profile) return null;
  const lines = [];
  if (profile.business_name) lines.push(`**${profile.business_name}**`);
  if (profile.offer)         lines.push(`📦 ${profile.offer}`);
  if (profile.price_amount)  lines.push(`💰 ${profile.price_amount} ${profile.price_currency || 'ILS'} — ${profile.pricing_model || ''}`);
  if (profile.target_audience) lines.push(`👥 קהל: ${profile.target_audience}`);
  if (profile.problem_solved)  lines.push(`🎯 בעיה: ${profile.problem_solved}`);
  if (profile.primary_goal)    lines.push(`⚡ מטרה: ${GOAL_LABELS[profile.primary_goal] || profile.primary_goal}`);
  return lines.join('\n');
}

/**
 * buildNextProfileQuestion(missingRequired, missingEnrichment)
 * Returns the single most important missing field as a Hebrew prompt.
 */
function buildNextProfileQuestion(missingRequired, missingEnrichment) {
  const QUESTIONS = {
    offer:            'מה בדיוק אתה מוכר? (משפט אחד, ספציפי)',
    price_amount:     'מה המחיר של ההצעה שלך? (מספר בלבד)',
    target_audience:  'למי אתה מוכר? תאר את הלקוח האידיאלי שלך במשפט אחד',
    problem_solved:   'מה הבעיה הספציפית שאתה פותר? (לא "אני עוזר לאנשים" — מה כואב להם בדיוק)',
    desired_outcome:  'מה הלקוח מקבל בסוף? מה משתנה אצלו? (תוצאה מדידה)',
    primary_goal:     'מה המטרה העיקרית של הקמפיין? (לידים / מכירות ישירות / פגישות)',
    business_name:    'מה שם העסק שלך?',
    category:         'באיזה קטגוריה? (שירותים / מוצרים / קורס / SaaS)',
    unique_mechanism: 'מה ה-"איך" הייחודי שלך? מה עושה את ההצעה שלך שונה מהמתחרים?',
    main_promise:     'מה ההבטחה המרכזית שלך — המשפט שיעצור מישהו תוך שניה?',
    monthly_budget:   'מה התקציב החודשי שלך לפרסום?',
  };
  const next = [...missingRequired, ...missingEnrichment][0];
  return next ? QUESTIONS[next] || null : null;
}

module.exports = {
  loadBusinessProfile,
  upsertBusinessProfile,
  scoreCompletion,
  formatProfileSummary,
  buildNextProfileQuestion,
  FIELD_LABELS,
  CATEGORY_LABELS,
  GOAL_LABELS,
};
