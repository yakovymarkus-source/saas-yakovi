/**
 * profile-intake-extractor.unit.test.js
 *
 * Tests for profile-intake-extractor.js — zero DB, zero network.
 * Covers: structured extractors (price, goal, category, model) + free-text + main export.
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');

const {
  extractProfileAnswer,
  extractPrice,
  extractGoal,
  extractCategory,
  extractPricingModel,
  extractFreeText,
} = require('../../netlify/functions/_shared/profile-intake-extractor');

// ═══════════════════════════════════════════════════════════════════════════════
// extractPrice
// ═══════════════════════════════════════════════════════════════════════════════

test('extractPrice — plain integer', () => {
  assert.equal(extractPrice('499'), 499);
});

test('extractPrice — with shekel sign', () => {
  assert.equal(extractPrice('₪1500'), 1500);
});

test('extractPrice — with שקל suffix', () => {
  assert.equal(extractPrice('299 שקל'), 299);
});

test('extractPrice — with ש"ח suffix', () => {
  assert.equal(extractPrice('799 ש"ח'), 799);
});

test('extractPrice — comma-formatted number', () => {
  assert.equal(extractPrice('1,500'), 1500);
});

test('extractPrice — USD', () => {
  assert.equal(extractPrice('$99'), 99);
});

test('extractPrice — embedded in sentence', () => {
  assert.equal(extractPrice('המחיר הוא 350 שקל לחודש'), 350);
});

test('extractPrice — returns null for text with no number', () => {
  assert.equal(extractPrice('לא יודע'), null);
});

test('extractPrice — returns null for zero', () => {
  assert.equal(extractPrice('0'), null);
});

// ═══════════════════════════════════════════════════════════════════════════════
// extractGoal
// ═══════════════════════════════════════════════════════════════════════════════

test('extractGoal — לידים → leads', () => {
  assert.equal(extractGoal('אני רוצה לידים'), 'leads');
});

test('extractGoal — מכירות → sales', () => {
  assert.equal(extractGoal('מטרתי מכירות ישירות'), 'sales');
});

test('extractGoal — פגישות → appointments', () => {
  assert.equal(extractGoal('קביעת פגישות עם לקוחות'), 'appointments');
});

test('extractGoal — awareness', () => {
  assert.equal(extractGoal('מטרה היא מודעות למותג'), 'awareness');
});

test('extractGoal — English lead', () => {
  assert.equal(extractGoal('I need leads'), 'leads');
});

test('extractGoal — returns null for unrecognised text', () => {
  assert.equal(extractGoal('אני לא יודע'), null);
});

// ═══════════════════════════════════════════════════════════════════════════════
// extractCategory
// ═══════════════════════════════════════════════════════════════════════════════

test('extractCategory — חנות → ecommerce', () => {
  assert.equal(extractCategory('יש לי חנות אונליין'), 'ecommerce');
});

test('extractCategory — קורס → course', () => {
  assert.equal(extractCategory('אני מוכר קורס אונליין'), 'course');
});

test('extractCategory — SaaS', () => {
  assert.equal(extractCategory('אני בונה SaaS לעסקים'), 'saas');
});

test('extractCategory — תוכנה → saas', () => {
  assert.equal(extractCategory('יש לי תוכנה'), 'saas');
});

test('extractCategory — שירות → services', () => {
  assert.equal(extractCategory('אני מציע שירות ייעוץ'), 'services');
});

test('extractCategory — לידים → lead_generation', () => {
  assert.equal(extractCategory('עסק לידים'), 'lead_generation');
});

test('extractCategory — returns null for unknown', () => {
  assert.equal(extractCategory('משהו אחר לגמרי'), null);
});

// ═══════════════════════════════════════════════════════════════════════════════
// extractPricingModel
// ═══════════════════════════════════════════════════════════════════════════════

test('extractPricingModel — חודשי → recurring', () => {
  assert.equal(extractPricingModel('תשלום חודשי'), 'recurring');
});

test('extractPricingModel — מנוי → recurring', () => {
  assert.equal(extractPricingModel('מנוי שנתי'), 'recurring');
});

test('extractPricingModel — חד פעמי → one_time', () => {
  assert.equal(extractPricingModel('חד פעמי'), 'one_time');
});

test('extractPricingModel — לפגישה → session', () => {
  assert.equal(extractPricingModel('גובה לפגישה'), 'session');
});

test('extractPricingModel — ריטיינר → retainer', () => {
  assert.equal(extractPricingModel('ריטיינר חודשי'), 'retainer');
});

test('extractPricingModel — חינם → free', () => {
  assert.equal(extractPricingModel('השירות חינם'), 'free');
});

test('extractPricingModel — null for unknown', () => {
  assert.equal(extractPricingModel('אני לא בטוח'), null);
});

// ═══════════════════════════════════════════════════════════════════════════════
// extractFreeText
// ═══════════════════════════════════════════════════════════════════════════════

test('extractFreeText — strips "אני מוכר" prefix', () => {
  const result = extractFreeText('אני מוכר קורסי פיטנס');
  assert.equal(result, 'קורסי פיטנס');
});

test('extractFreeText — strips "מוכר" prefix alone', () => {
  const result = extractFreeText('מוכר ייעוץ שיווקי');
  assert.equal(result, 'ייעוץ שיווקי');
});

test('extractFreeText — returns null for questions', () => {
  assert.equal(extractFreeText('מה זה?'), null);
  assert.equal(extractFreeText('מה אני אמור לענות?'), null);
});

test('extractFreeText — returns null for text > 200 chars', () => {
  const long = 'א'.repeat(201);
  assert.equal(extractFreeText(long), null);
});

test('extractFreeText — returns null for very short (<3 chars)', () => {
  assert.equal(extractFreeText('כן'), null);
});

test('extractFreeText — returns the text cleaned', () => {
  const result = extractFreeText('ייעוץ עסקי לבעלי עסקים קטנים');
  assert.equal(result, 'ייעוץ עסקי לבעלי עסקים קטנים');
});

// ═══════════════════════════════════════════════════════════════════════════════
// extractProfileAnswer — main export
// ═══════════════════════════════════════════════════════════════════════════════

test('extractProfileAnswer — extracts price for missing price_amount', () => {
  const result = extractProfileAnswer('499 שקל', ['offer', 'price_amount'], []);
  // offer is first but '499 שקל' is short so extractFreeText would return '499 שקל'
  // but we try offer first, then price_amount
  // Actually offer extractor would grab it... let's check with price_amount only missing
  const result2 = extractProfileAnswer('499', ['price_amount'], []);
  assert.ok(result2);
  assert.equal(result2.field, 'price_amount');
  assert.equal(result2.value, 499);
});

test('extractProfileAnswer — extracts primary_goal', () => {
  const result = extractProfileAnswer('המטרה היא לידים', ['primary_goal'], []);
  assert.ok(result);
  assert.equal(result.field, 'primary_goal');
  assert.equal(result.value, 'leads');
});

test('extractProfileAnswer — returns null for empty message', () => {
  assert.equal(extractProfileAnswer('', ['offer'], []), null);
});

test('extractProfileAnswer — returns null when no fields missing', () => {
  assert.equal(extractProfileAnswer('אני מוכר משהו', [], []), null);
});

test('extractProfileAnswer — tries required fields before enrichment', () => {
  // missingRequired has price_amount, missingEnrichment has category
  // message has a price number → should extract price_amount
  const result = extractProfileAnswer('350', ['price_amount'], ['category']);
  assert.ok(result);
  assert.equal(result.field, 'price_amount');
});

test('extractProfileAnswer — falls through to enrichment when required extractor fails', () => {
  // Only missing required field is primary_goal, but message has category keyword
  // goal extractor won't fire on this message, but if we skip required and check enrichment...
  // Let's test: required = ['primary_goal'], enrichment = ['category'], message = 'SaaS'
  const result = extractProfileAnswer('SaaS', ['primary_goal'], ['category']);
  // primary_goal extractor returns null for 'SaaS', category extractor returns 'saas'
  assert.ok(result);
  assert.equal(result.field, 'category');
  assert.equal(result.value, 'saas');
});

test('extractProfileAnswer — confirmationText is non-empty string', () => {
  const result = extractProfileAnswer('499', ['price_amount'], []);
  assert.ok(result);
  assert.ok(typeof result.confirmationText === 'string');
  assert.ok(result.confirmationText.length > 0);
  assert.ok(result.confirmationText.includes('₪499'));
});

test('extractProfileAnswer — goal confirmationText uses Hebrew label', () => {
  const result = extractProfileAnswer('לידים', ['primary_goal'], []);
  assert.ok(result);
  assert.ok(result.confirmationText.includes('איסוף לידים'));
});
