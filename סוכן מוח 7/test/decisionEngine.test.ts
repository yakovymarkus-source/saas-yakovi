import test from 'node:test';
import assert from 'node:assert/strict';
import { runDecisionEngine, ENGINE_VERSION } from '../src/engine/decisionEngine';
import { engineConfig } from '../src/config/engineConfig';

test('decisionEngine exposes version and config-backed weights in decision log', () => {
  const result = runDecisionEngine(
    { name: 'Campaign', objective: 'sales', currency: 'USD' },
    {
      impressions: 1000,
      clicks: 8,
      spend: 300,
      landingPageViews: 100,
      sessions: 50,
      leads: 2,
      purchases: 1,
      revenue: 200,
      frequency: 4,
      bounceRate: 0.65,
      addToCart: 3,
      initiatedCheckout: 2
    },
    {
      ctr: 0.008,
      cpc: 37.5,
      cpa: 150,
      conversionRate: 0.02,
      landingPageDropoffRate: 0.5,
      sessionDropoffRate: 0.5,
      checkoutDropoffRate: 0.33,
      roas: 0.66
    }
  );

  assert.equal(ENGINE_VERSION, '1.0.0');
  assert.deepEqual(result.decisionLog.weights, engineConfig.weights);
  assert.equal(result.decisionLog.engineVersion, ENGINE_VERSION);
});
