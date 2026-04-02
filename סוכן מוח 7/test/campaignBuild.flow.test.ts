import test from 'node:test';
import assert from 'node:assert/strict';
import { runCampaignBuild } from '../src/agent/campaignOrchestrator';
import { runPerformanceAnalysis } from '../src/agent/optimization/performanceAnalyst';
import { improveAssetFromDiagnosis } from '../src/engine/campaignRulesEngine';

const input = {
  business: {
    businessName: 'SharpFlow',
    category: 'B2B SaaS',
    productType: 'subscription' as const,
    offer: 'Pipeline visibility platform',
    pricing: { currency: 'USD', amount: 299, model: 'monthly' },
    targetOutcome: 'יותר דמואים איכותיים',
    audienceHint: 'מנהלי שיווק B2B שנמאס להם מלידים חלשים',
    currentAssets: {},
    constraints: [],
    budget: { monthly: 8000, testBudget: 1500 },
    goals: { primary: 'sales' as const, cpaTarget: 120 },
    historicalPerformance: { currentCvR: 2.1, leadToCallRate: 18, closeRate: 12 }
  }
};

test('full campaign build flow returns aligned, ranked and passed assets', async () => {
  const bundle = await runCampaignBuild(input);

  assert.equal(bundle.verdict.status, 'approved');
  assert.ok((bundle.verdict.confidenceScore ?? 0) >= 70);
  assert.equal(bundle.verdict.targetAudience, bundle.audience.corePersona.label);
  assert.equal(bundle.verdict.angle, bundle.positioning.coreAngle);
  assert.ok(bundle.offer.offerStructure.some((item) => item.includes(bundle.positioning.coreAngle)));
  assert.equal(bundle.adPack.ads.length, 4);
  assert.equal(new Set(bundle.adPack.ads.map((ad) => ad.hook)).size, 4);
  assert.ok(bundle.landingCopy.qualityScore);
  assert.equal(bundle.landingCopy.qualityScore?.status, 'pass');
  assert.ok((bundle.landingCopy.qualityScore?.total ?? 0) >= 85);
  assert.ok(bundle.adPack.ads.every((ad) => (ad.qualityScore?.status ?? 'reject') === 'pass'));
  assert.ok(bundle.videoPack.scripts.every((script) => (script.qualityScore?.status ?? 'reject') === 'pass'));
  assert.ok(bundle.adPack.selectedVariantId);
  assert.ok(bundle.videoPack.selectedVariantId);
});

test('verdict consistency forces single strategy decision', async () => {
  const bundle = await runCampaignBuild(input);
  assert.equal(typeof bundle.verdict.targetAudience, 'string');
  assert.equal(typeof bundle.verdict.angle, 'string');
  assert.equal(typeof bundle.verdict.offerType, 'string');
  assert.equal(typeof bundle.verdict.funnelType, 'string');
  assert.equal(typeof bundle.verdict.ctaDirection, 'string');
  assert.ok((bundle.verdict.rejectedOptions ?? []).length >= 2);
});

test('offer, funnel and asset CTA stay aligned', async () => {
  const bundle = await runCampaignBuild(input);
  const finalStep = bundle.funnel.steps[bundle.funnel.steps.length - 1];
  if (bundle.offer.ctaType === 'buy_now') {
    assert.match(finalStep.cta, /רכישה|קנה/i);
    assert.ok(bundle.landingCopy.ctas.every((cta) => /לקנייה/i.test(cta)));
  }
  if (bundle.offer.ctaType === 'book_call') assert.match(finalStep.cta, /שיחה|call/i);
  if (bundle.offer.ctaType === 'leave_details') assert.match(finalStep.cta, /פרטים/i);
});

test('ad generation produces materially different ranked variations', async () => {
  const bundle = await runCampaignBuild(input);
  assert.equal(new Set(bundle.adPack.ads.map((ad) => ad.variationTheme)).size, 4);
  assert.ok(bundle.adPack.ads.every((ad) => ad.awarenessStage));
  assert.ok(bundle.adPack.rankings?.[0].selected);
  assert.equal(bundle.adPack.rankings?.length, bundle.adPack.ads.length);
});

test('performance diagnosis returns causal prioritized analysis and regeneration briefs', async () => {
  const diagnosis = await runPerformanceAnalysis({ ctr: 0.7, hookRate: 12, cpc: 3.2, cvr: 1.1, bounceRate: 78, leadToCallRate: 10 });
  assert.ok((diagnosis.issues?.length ?? 0) >= 3);
  assert.ok(diagnosis.issues?.every((issue) => issue.finding && issue.rootCause && issue.businessMeaning && issue.recommendedAction));
  assert.equal(diagnosis.priorityOrder.length, diagnosis.issues?.length);
  assert.equal(diagnosis.issues?.[0]?.priority, 1);
  assert.ok((diagnosis.issues?.[0]?.confidence ?? 0) >= 75);
  assert.ok((diagnosis.regenerationBriefs?.length ?? 0) >= 2);
});

test('performance diagnosis can drive version n+1 regeneration', async () => {
  const bundle = await runCampaignBuild(input);
  const diagnosis = await runPerformanceAnalysis({ ctr: 0.6, hookRate: 10, cvr: 1.2, bounceRate: 82 });
  const improvedAdPack = improveAssetFromDiagnosis('ad', bundle.adPack, diagnosis);
  assert.notDeepEqual(improvedAdPack, bundle.adPack);
  assert.equal(improvedAdPack.optimizationSource, 'performance_diagnosis');
});
