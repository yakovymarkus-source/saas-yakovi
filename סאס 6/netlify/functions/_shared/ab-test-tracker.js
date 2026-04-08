'use strict';

/**
 * ab-test-tracker.js — Testing Architecture (Layer 24)
 *
 * Manages A/B tests: one variable at a time, clear hypothesis, defined stop
 * conditions. Follows the system rule:
 *   "לא מחליפים הכול ביחד. בודקים משתנה אחד."
 *
 * Operations:
 *   createTest()    — open a new test
 *   loadRunningTests() — get all active tests for a user
 *   concludeTest()  — mark winner and close
 *   invalidateTest() — cancel without a verdict
 *   getDueTests()   — tests that have passed their planned duration
 *
 * All DB calls use admin client (server-side only).
 * Users can read/write their own rows via RLS from the client if needed.
 */

const { getAdminClient } = require('./supabase');

// Valid test variable types (matches schema CHECK constraint)
const VALID_VARIABLES = new Set([
  'headline', 'hook', 'creative', 'cta', 'offer_framing',
  'audience', 'landing_order', 'copy',
]);

const VARIABLE_LABELS = {
  headline:      'כותרת',
  hook:          'הוק',
  creative:      'קריאייטיב',
  cta:           'CTA',
  offer_framing: 'מסגור הצעה',
  audience:      'קהל',
  landing_order: 'סדר דף',
  copy:          'קופי',
};

const STATUS_LABELS = {
  running:     '▶️ פעיל',
  paused:      '⏸️ מושהה',
  concluded:   '✅ הסתיים',
  invalidated: '❌ בוטל',
};

const WINNER_LABELS = {
  control:      '🏆 ברירת המחדל ניצחה',
  variant:      '🏆 הוריאציה ניצחה',
  inconclusive: '🤝 לא מסקנה',
};

// ── Validation ────────────────────────────────────────────────────────────────

function validateTestInput({ hypothesis, variable_name, control_value, variant_value }) {
  const errors = [];
  if (!hypothesis    || hypothesis.trim().length < 10) errors.push('hypothesis חייב להיות לפחות 10 תווים');
  if (!variable_name || !VALID_VARIABLES.has(variable_name)) {
    errors.push(`variable_name חייב להיות אחד מ: ${[...VALID_VARIABLES].join(', ')}`);
  }
  if (!control_value || control_value.trim().length === 0) errors.push('control_value חסר');
  if (!variant_value || variant_value.trim().length === 0) errors.push('variant_value חסר');
  if (control_value && variant_value && control_value.trim() === variant_value.trim()) {
    errors.push('control_value ו-variant_value חייבים להיות שונים');
  }
  return errors;
}

// ── Create ────────────────────────────────────────────────────────────────────

/**
 * createTest(userId, testData)
 * Opens a new A/B test. Enforces one active test per variable per user.
 *
 * @param {string} userId
 * @param {object} testData
 *   {
 *     hypothesis, variable_name, control_value, variant_value,
 *     campaign_id?, constants?, planned_days?, min_impressions?, stop_condition?
 *   }
 * @returns {{ test: object|null, error: string|null }}
 */
async function createTest(userId, testData) {
  const errors = validateTestInput(testData);
  if (errors.length) return { test: null, error: errors.join('. ') };

  try {
    const sb = getAdminClient();

    // Check: no running test for this variable already
    const { data: existing } = await sb
      .from('ab_tests')
      .select('id, variable_name, status')
      .eq('user_id', userId)
      .eq('variable_name', testData.variable_name)
      .eq('status', 'running')
      .maybeSingle();

    if (existing) {
      return {
        test:  null,
        error: `כבר יש בדיקה פעילה על ${VARIABLE_LABELS[testData.variable_name] || testData.variable_name}. סיים אותה לפני שפותחים חדשה.`,
      };
    }

    const { data, error } = await sb
      .from('ab_tests')
      .insert({
        user_id:       userId,
        campaign_id:   testData.campaign_id   || null,
        hypothesis:    testData.hypothesis.trim(),
        variable_name: testData.variable_name,
        control_value: testData.control_value.trim(),
        variant_value: testData.variant_value.trim(),
        constants:     Array.isArray(testData.constants) ? testData.constants : [],
        planned_days:  testData.planned_days    || 7,
        min_impressions: testData.min_impressions || 1000,
        stop_condition: testData.stop_condition  || null,
        status:        'running',
      })
      .select()
      .maybeSingle();

    if (error) return { test: null, error: error.message };
    return { test: data, error: null };
  } catch (e) {
    console.warn('[ab-test-tracker] createTest failed:', e.message);
    return { test: null, error: e.message };
  }
}

// ── Read ──────────────────────────────────────────────────────────────────────

/**
 * loadRunningTests(userId)
 * Returns all tests with status='running' for the user, newest first.
 */
async function loadRunningTests(userId) {
  if (!userId) return [];
  try {
    const { data } = await getAdminClient()
      .from('ab_tests')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'running')
      .order('created_at', { ascending: false });
    return data || [];
  } catch (e) {
    console.warn('[ab-test-tracker] loadRunning failed:', e.message);
    return [];
  }
}

/**
 * loadAllTests(userId, limit)
 * Returns recent tests of all statuses.
 */
async function loadAllTests(userId, limit = 10) {
  if (!userId) return [];
  try {
    const { data } = await getAdminClient()
      .from('ab_tests')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
    return data || [];
  } catch (e) {
    console.warn('[ab-test-tracker] loadAll failed:', e.message);
    return [];
  }
}

/**
 * getDueTests(userId)
 * Returns running tests that have passed their planned end date.
 * Used to prompt the user to conclude a test.
 */
async function getDueTests(userId) {
  if (!userId) return [];
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { data } = await getAdminClient()
      .from('ab_tests')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'running')
      .lte('start_date', today);   // start_date + planned_days approximation via JS filter

    const due = (data || []).filter(t => {
      const endDate = new Date(t.start_date);
      endDate.setDate(endDate.getDate() + (t.planned_days || 7));
      return new Date(today) >= endDate;
    });
    return due;
  } catch (e) {
    console.warn('[ab-test-tracker] getDue failed:', e.message);
    return [];
  }
}

// ── Conclude ──────────────────────────────────────────────────────────────────

/**
 * concludeTest(userId, testId, { winner, result_summary })
 * Marks a test as concluded with a winner verdict.
 *
 * @param {string} winner — 'control' | 'variant' | 'inconclusive'
 */
async function concludeTest(userId, testId, { winner, result_summary }) {
  const VALID_WINNERS = new Set(['control', 'variant', 'inconclusive']);
  if (!VALID_WINNERS.has(winner)) {
    return { ok: false, error: 'winner חייב להיות: control / variant / inconclusive' };
  }
  try {
    const { error } = await getAdminClient()
      .from('ab_tests')
      .update({
        status:         'concluded',
        winner,
        result_summary: result_summary || null,
        concluded_at:   new Date().toISOString().slice(0, 10),
      })
      .eq('id', testId)
      .eq('user_id', userId)
      .eq('status', 'running');

    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    console.warn('[ab-test-tracker] conclude failed:', e.message);
    return { ok: false, error: e.message };
  }
}

/**
 * invalidateTest(userId, testId, reason)
 * Cancels a test without a verdict (e.g., external factor changed the data).
 */
async function invalidateTest(userId, testId, reason) {
  try {
    const { error } = await getAdminClient()
      .from('ab_tests')
      .update({ status: 'invalidated', result_summary: reason || null })
      .eq('id', testId)
      .eq('user_id', userId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── Chat formatting ───────────────────────────────────────────────────────────

/**
 * formatTestCard(test)
 * Returns a Hebrew summary card for one test.
 */
function formatTestCard(test) {
  const varLabel = VARIABLE_LABELS[test.variable_name] || test.variable_name;
  const endDate  = new Date(test.start_date);
  endDate.setDate(endDate.getDate() + (test.planned_days || 7));
  const endStr   = endDate.toLocaleDateString('he-IL');

  let card = `**🔬 בדיקה: ${varLabel}**\n`;
  card += `  📝 **השערה:** ${test.hypothesis}\n`;
  card += `  🅰️ **ברירת מחדל:** ${test.control_value}\n`;
  card += `  🅱️ **וריאציה:** ${test.variant_value}\n`;
  card += `  📅 **מועד סיום מתוכנן:** ${endStr}`;
  if (test.stop_condition) card += `\n  🛑 **תנאי עצירה:** ${test.stop_condition}`;
  if (test.status === 'concluded' && test.winner) {
    card += `\n  ${WINNER_LABELS[test.winner]}`;
    if (test.result_summary) card += ` — ${test.result_summary}`;
  }
  return card;
}

/**
 * buildNextTestSuggestion(runningTests, bottleneckStage)
 * Suggests what to test next based on current bottleneck, avoiding variables already under test.
 */
function buildNextTestSuggestion(runningTests, bottleneckStage) {
  const alreadyTesting = new Set((runningTests || []).map(t => t.variable_name));

  const BOTTLENECK_SUGGESTIONS = {
    creative:     ['headline', 'hook', 'creative'],
    landing_page: ['cta', 'offer_framing', 'landing_order'],
    budget:       ['offer_framing', 'audience'],
    traffic:      ['audience', 'creative'],
  };

  const candidates = (BOTTLENECK_SUGGESTIONS[bottleneckStage] || ['headline', 'hook'])
    .filter(v => !alreadyTesting.has(v));

  if (candidates.length === 0) return null;

  const VARIABLE_GUIDANCE = {
    headline:      'נסה 2 כותרות שונות — שמור כל שאר המסר זהה.',
    hook:          'נסה הוק מבוסס-בעיה מול הוק מבוסס-תוצאה.',
    creative:      'נסה תמונה מול וידאו, או תמונה עם טקסט מול תמונה בלי טקסט.',
    cta:           'נסה "השאר פרטים" מול "קבל הצעת מחיר" — CTA אחד בדף.',
    offer_framing: 'נסה מסגור מחיר (₪X לחודש) מול מסגור ערך (חסוך X שעות בשבוע).',
    audience:      'נסה קהל Lookalike מול קהל תחום עניין — תקציב שווה לשניהם.',
    landing_order: 'נסה Social Proof before עם Offer אחרי, מול Offer ראשון.',
  };

  return {
    variable:    candidates[0],
    label:       VARIABLE_LABELS[candidates[0]],
    guidance:    VARIABLE_GUIDANCE[candidates[0]] || 'שמור על משתנה אחד שונה בלבד.',
  };
}

module.exports = {
  createTest,
  loadRunningTests,
  loadAllTests,
  getDueTests,
  concludeTest,
  invalidateTest,
  formatTestCard,
  buildNextTestSuggestion,
  VARIABLE_LABELS,
  STATUS_LABELS,
  WINNER_LABELS,
};
