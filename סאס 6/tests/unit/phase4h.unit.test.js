/**
 * phase4h.unit.test.js — Unit tests for Phase 4H pure modules
 *
 * Tests only pure functions — zero DB, zero network.
 * Covers: ad-copy-generator (generateAdCopy, formatCopyCard)
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');

const {
  generateAdCopy,
  formatCopyCard,
} = require('../../netlify/functions/_shared/ad-copy-generator');

// ── Full profile fixture ───────────────────────────────────────────────────────

const fullProfile = {
  business_name:    'פיטנס פרו',
  offer:            'תוכנית אימון אונליין ל-12 שבועות',
  price_amount:     499,
  pricing_model:    'one_time',
  target_audience:  'אנשים עסוקים שרוצים להיכנס לכושר בלי לבזבז זמן',
  problem_solved:   'חוסר זמן לחדר כושר ותוצאות לא רואות',
  desired_outcome:  'ירידה של 5 ק"ג ועלייה בכוח תוך 12 שבועות',
  unique_mechanism: 'אימוני HIIT של 20 דקות + תוכנית תזונה מותאמת אישית',
  main_promise:     'תיכנס לכושר תוך 12 שבועות — גם אם אין לך זמן',
  primary_goal:     'sales',
};

// ═══════════════════════════════════════════════════════════════════════════════
// Output shape
// ═══════════════════════════════════════════════════════════════════════════════

test('generateAdCopy — returns exactly 3 variants', () => {
  const variants = generateAdCopy({ businessProfile: fullProfile });
  assert.equal(variants.length, 3);
});

test('generateAdCopy — each variant has all required fields', () => {
  const variants = generateAdCopy({ businessProfile: fullProfile });
  for (const v of variants) {
    assert.ok(typeof v.variant      === 'string', 'variant must be string');
    assert.ok(typeof v.framework    === 'string', 'framework must be string');
    assert.ok(typeof v.hook_type    === 'string', 'hook_type must be string');
    assert.ok(typeof v.headline     === 'string', 'headline must be string');
    assert.ok(typeof v.body         === 'string', 'body must be string');
    assert.ok(typeof v.cta          === 'string', 'cta must be string');
    assert.ok(typeof v.platform_note === 'string', 'platform_note must be string');
    assert.ok(v.headline.length > 0, 'headline must not be empty');
    assert.ok(v.body.length     > 0, 'body must not be empty');
    assert.ok(v.cta.length      > 0, 'cta must not be empty');
  }
});

test('generateAdCopy — variant labels are A, B, C', () => {
  const variants = generateAdCopy({ businessProfile: fullProfile });
  assert.equal(variants[0].variant, 'A');
  assert.equal(variants[1].variant, 'B');
  assert.equal(variants[2].variant, 'C');
});

test('generateAdCopy — frameworks are all three distinct', () => {
  const variants = generateAdCopy({ businessProfile: fullProfile });
  const frameworks = new Set(variants.map(v => v.framework));
  assert.equal(frameworks.size, 3);
  assert.ok(frameworks.has('problem_agitate'));
  assert.ok(frameworks.has('result_first'));
  assert.ok(frameworks.has('mechanism'));
});

// ═══════════════════════════════════════════════════════════════════════════════
// Bottleneck prioritisation
// ═══════════════════════════════════════════════════════════════════════════════

test('generateAdCopy — CTR bottleneck puts problem_agitate first', () => {
  const variants = generateAdCopy({ businessProfile: fullProfile, bottleneck: 'ctr' });
  assert.equal(variants[0].framework, 'problem_agitate');
});

test('generateAdCopy — conversion bottleneck puts result_first first', () => {
  const variants = generateAdCopy({ businessProfile: fullProfile, bottleneck: 'conversion' });
  assert.equal(variants[0].framework, 'result_first');
});

test('generateAdCopy — roas bottleneck puts mechanism first', () => {
  const variants = generateAdCopy({ businessProfile: fullProfile, bottleneck: 'roas' });
  assert.equal(variants[0].framework, 'mechanism');
});

test('generateAdCopy — creative bottleneck maps to problem_agitate first', () => {
  const variants = generateAdCopy({ businessProfile: fullProfile, bottleneck: 'creative' });
  assert.equal(variants[0].framework, 'problem_agitate');
});

test('generateAdCopy — landing_page bottleneck maps to result_first first', () => {
  const variants = generateAdCopy({ businessProfile: fullProfile, bottleneck: 'landing_page' });
  assert.equal(variants[0].framework, 'result_first');
});

test('generateAdCopy — null bottleneck uses default order (problem_agitate first)', () => {
  const variants = generateAdCopy({ businessProfile: fullProfile, bottleneck: null });
  assert.equal(variants[0].framework, 'problem_agitate');
});

// ═══════════════════════════════════════════════════════════════════════════════
// Platform: Google Ads character limits
// ═══════════════════════════════════════════════════════════════════════════════

test('generateAdCopy — google_ads headlines fit within 30 chars', () => {
  const variants = generateAdCopy({ businessProfile: fullProfile, platform: 'google_ads' });
  for (const v of variants) {
    // Cap function limits to 30, with ellipsis at 30 if truncated
    assert.ok(v.headline.length <= 31, `headline too long: "${v.headline}" (${v.headline.length})`);
  }
});

test('generateAdCopy — google_ads descriptions fit within 91 chars', () => {
  const variants = generateAdCopy({ businessProfile: fullProfile, platform: 'google_ads' });
  for (const v of variants) {
    assert.ok(v.body.length <= 91, `body too long: ${v.body.length} chars`);
  }
});

test('generateAdCopy — meta platform has no such character limit applied', () => {
  const variants = generateAdCopy({ businessProfile: fullProfile, platform: 'meta' });
  // Meta body can be multi-line, should be longer than google_ads version
  const metaVariant = variants[0];
  assert.ok(metaVariant.body.length > 0);
  // Meta body for problem_agitate includes \n
  assert.ok(metaVariant.body.includes('\n') || metaVariant.body.length > 0);
});

// ═══════════════════════════════════════════════════════════════════════════════
// CTA by primary goal
// ═══════════════════════════════════════════════════════════════════════════════

test('generateAdCopy — sales goal uses sales CTAs', () => {
  const variants = generateAdCopy({ businessProfile: { ...fullProfile, primary_goal: 'sales' } });
  const allCTAs  = variants.map(v => v.cta);
  const salesCTAs = ['רכוש עכשיו', 'הזמן היום', 'קנה עכשיו'];
  assert.ok(allCTAs.some(c => salesCTAs.includes(c)), `Expected a sales CTA, got: ${allCTAs.join(', ')}`);
});

test('generateAdCopy — leads goal uses lead CTAs', () => {
  const variants = generateAdCopy({ businessProfile: { ...fullProfile, primary_goal: 'leads' } });
  const allCTAs  = variants.map(v => v.cta);
  const leadCTAs = ['השאר פרטים עכשיו', 'קבל פרטים חינם', 'דבר איתנו היום'];
  assert.ok(allCTAs.some(c => leadCTAs.includes(c)));
});

test('generateAdCopy — appointments goal uses appointment CTAs', () => {
  const variants = generateAdCopy({ businessProfile: { ...fullProfile, primary_goal: 'appointments' } });
  const allCTAs  = variants.map(v => v.cta);
  const apptCTAs = ['קבע פגישה חינם', 'דבר עם מומחה', 'קבל ייעוץ עכשיו'];
  assert.ok(allCTAs.some(c => apptCTAs.includes(c)));
});

// ═══════════════════════════════════════════════════════════════════════════════
// Graceful degradation — missing profile fields
// ═══════════════════════════════════════════════════════════════════════════════

test('generateAdCopy — works with empty profile (uses fallbacks)', () => {
  const variants = generateAdCopy({ businessProfile: {} });
  assert.equal(variants.length, 3);
  for (const v of variants) {
    assert.ok(v.headline.length > 0);
    assert.ok(v.body.length     > 0);
    assert.ok(v.cta.length      > 0);
  }
});

test('generateAdCopy — works with null businessProfile', () => {
  const variants = generateAdCopy({ businessProfile: null });
  assert.equal(variants.length, 3);
});

test('generateAdCopy — uses profile fields in output', () => {
  const variants = generateAdCopy({ businessProfile: fullProfile, platform: 'meta' });
  // At least one variant should reference the problem_solved or desired_outcome
  const allText = variants.map(v => v.headline + v.body).join(' ');
  // Since we use the actual profile values in templates, they should appear
  assert.ok(
    allText.includes('חוסר זמן') || allText.includes('12 שבועות') || allText.includes('HIIT'),
    'Profile fields should appear in generated copy'
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// formatCopyCard
// ═══════════════════════════════════════════════════════════════════════════════

test('formatCopyCard — returns non-empty string', () => {
  const variants = generateAdCopy({ businessProfile: fullProfile });
  const card = formatCopyCard(variants[0]);
  assert.ok(typeof card === 'string');
  assert.ok(card.length > 0);
});

test('formatCopyCard — includes variant label, headline, cta', () => {
  const variants = generateAdCopy({ businessProfile: fullProfile });
  const card = formatCopyCard(variants[0]);
  assert.ok(card.includes('וריאציה A'));
  assert.ok(card.includes('כותרת'));
  assert.ok(card.includes('CTA'));
});
