'use strict';
/**
 * qa/core/test-plan-builder.js
 * Builds an A/B test plan based on QA findings.
 * Identifies which variables to test, what variants to create, and what hypothesis to validate.
 */

function buildTestPlan({ assets, qaChecks, brief, variantCount }) {
  const tests = [];
  const variants = variantCount || 2;

  // ── 1. Hook Test ──────────────────────────────────────────────────────────
  const hooks = assets.hooks || [];
  if (hooks.length >= 2) {
    tests.push({
      variable:   'hook',
      priority:   'high',
      variants:   hooks.slice(0, Math.min(variants, hooks.length)).map((h, i) => ({
        label: `הוק ${i+1}`,
        text:  h.text || h,
        angle: h.type || null,
      })),
      hypothesis: 'הוק שמבוסס על כאב ספציפי יעצור גלילה טוב יותר מהוק שמבוסס על תוצאה',
      metric:     'CTR / Thumb-Stop Rate',
      winner_signal: 'CTR גבוה יותר ב-20%+ מצביע על הוק מנצח',
    });
  }

  // ── 2. CTA Test ────────────────────────────────────────────────────────────
  const ctas = assets.cta || [];
  if (ctas.length >= 2) {
    tests.push({
      variable:   'cta',
      priority:   'high',
      variants:   ctas.slice(0, 2).map((c, i) => ({
        label: `CTA ${i+1}`,
        text:  c.text || c,
        style: c.style || null,
      })),
      hypothesis: 'CTA ישיר ("קבל עכשיו") יניב המרה גבוהה יותר מ-CTA רך ("גלה עוד") לקהל מודע-לפתרון',
      metric:     'Conversion Rate',
      winner_signal: 'אחוז המרה גבוה יותר ב-15%+',
    });
  }

  // ── 3. Angle / Ad Variant Test ────────────────────────────────────────────
  const ads = assets.ads || [];
  if (ads.length >= 2) {
    tests.push({
      variable:   'angle',
      priority:   'medium',
      variants:   ads.slice(0, Math.min(variants, ads.length)).map((ad, i) => ({
        label:     `וריאנט ${i+1}`,
        angle:     ad.angleType || ad.theme || `וריאנט ${i+1}`,
        headline:  (ad.text || ad).headline || '',
      })),
      hypothesis: 'זווית מבוססת כאב תביא CPL נמוך יותר מזווית מבוססת תשוקה',
      metric:     'CPL / CPA',
      winner_signal: 'עלות לליד נמוכה יותר ב-20%+ אחרי 500 חשיפות לפחות',
    });
  }

  // ── 4. Landing Page Section Test ──────────────────────────────────────────
  if (assets.landing_page) {
    tests.push({
      variable:   'lp_hero',
      priority:   'medium',
      variants:   [
        { label: 'כותרת ממוקדת כאב', note: 'שים את הכאב הגדול ביותר בכותרת' },
        { label: 'כותרת ממוקדת תוצאה', note: 'שים את הפלט / השינוי הרצוי בכותרת' },
      ],
      hypothesis: 'כותרת ממוקדת תוצאה תוריד bounce rate בקהל מודע-לפתרון',
      metric:     'Bounce Rate / Time on Page',
      winner_signal: 'זמן שהייה גבוה ב-30%+ / bounce נמוך ב-15%+',
    });
  }

  // ── 5. Issue-Based Tests (from QA findings) ───────────────────────────────
  if (qaChecks?.languageIssues?.length > 0) {
    tests.push({
      variable:   'language_tone',
      priority:   'low',
      variants:   [
        { label: 'גרסה נוכחית', note: 'טון קיים' },
        { label: 'גרסה מחודדת', note: 'קיצור משפטים, הסרת buzzwords' },
      ],
      hypothesis: 'שפה חדה וישירה יותר תשפר engagement',
      metric:     'CTR',
      winner_signal: 'שיפור CTR ב-10%+',
    });
  }

  // ── Budget Guidance ───────────────────────────────────────────────────────
  const budgetGuidance = _buildBudgetGuidance(tests, brief);

  return {
    tests,
    totalTests:     tests.length,
    estimatedBudget: budgetGuidance,
    priority_order: tests.sort((a, b) => _priorityScore(b.priority) - _priorityScore(a.priority)).map(t => t.variable),
    recommendation: `התחל בבדיקת ${tests[0]?.variable || 'hook'} — זה ה-lever הכי גדול`,
  };
}

function _priorityScore(p) { return p === 'high' ? 3 : p === 'medium' ? 2 : 1; }

function _buildBudgetGuidance(tests, brief) {
  const highCount = tests.filter(t => t.priority === 'high').length;
  const platform  = brief?.platform || 'meta';
  const minBudget = platform === 'google' ? 50 : 30; // $ per variant per test
  const recommended = highCount * minBudget * 2;
  return {
    minimum_per_variant: `$${minBudget}`,
    recommended_total:   `$${recommended}`,
    note:                'הרץ כל בדיקה עד 500 חשיפות לפחות לפני שתחליט',
  };
}

module.exports = { buildTestPlan };
