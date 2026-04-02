import test from 'node:test';
import assert from 'node:assert/strict';
import { exportAnalysisResult } from '../src/output/exporter';
import { AnalysisResult } from '../src/types/domain';

const analysisResult: AnalysisResult = {
  analysisId: 'analysis-1',
  campaignId: 'campaign-1',
  userId: 'user-1',
  source: 'meta',
  engineVersion: '1.0.0',
  cached: false,
  createdAt: '2026-03-31T00:00:00.000Z',
  result: {
    verdict: 'Creative failure',
    confidence: 0.9,
    metrics: {
      ctr: 0.01,
      cpc: 1,
      cpa: 10,
      conversionRate: 0.1,
      landingPageDropoffRate: 0.2,
      sessionDropoffRate: 0.1,
      checkoutDropoffRate: 0.1,
      roas: 2
    },
    normalizedMetrics: {
      impressions: 100,
      clicks: 1,
      spend: 1,
      landingPageViews: 1,
      sessions: 1,
      leads: 1,
      purchases: 1,
      revenue: 2,
      frequency: 1,
      bounceRate: 0.1,
      addToCart: 1,
      initiatedCheckout: 1
    },
    issues: [],
    prioritizedActions: [],
    decisionLog: { alpha: undefined, beta: 'value' }
  }
};

test('exporter returns deterministic JSON-safe output', () => {
  const first = exportAnalysisResult(analysisResult);
  const second = exportAnalysisResult(analysisResult);

  assert.ok(first);
  assert.ok(second);
  assert.equal(first?.data, second?.data);
  assert.doesNotMatch(first?.data ?? '', /undefined/);
  assert.equal(first?.fileName, 'analysis-analysis-1.json');
});
