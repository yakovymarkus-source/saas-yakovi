import test from 'node:test';
import assert from 'node:assert/strict';
import { runAnalysis } from '../src/engine/pipeline';
import { HttpError } from '../src/utils/http';
import { AuthenticatedUser } from '../src/types/domain';
import { installInMemoryDb } from './helpers';

const user: AuthenticatedUser = {
  id: 'user-1',
  supabaseUserId: 'user-1',
  email: 'user@example.com',
  roles: ['authenticated'],
  permissions: ['analysis:run'],
  token: 'token'
};

test('runAnalysis returns a deterministic success result for valid input', async () => {
  const db = installInMemoryDb();
  const result = await runAnalysis(
    {
      source: 'meta',
      campaign: {
        name: 'Campaign A',
        objective: 'sales',
        currency: 'USD',
        manualMetrics: {
          impressions: 1000,
          clicks: 10,
          spend: 500,
          landingPageViews: 100,
          sessions: 60,
          leads: 1,
          purchases: 1,
          revenue: 200,
          frequency: 4,
          bounceRate: 0.7,
          addToCart: 4,
          initiatedCheckout: 2
        }
      }
    },
    user,
    { requestId: 'req-1', userId: user.id }
  );

  assert.equal(result.verdict, 'Landing page issue');
  assert.equal(result.decisionLog.engineVersion, '1.0.0');
  assert.ok(result.issues.length > 0);
  assert.ok(result.prioritizedActions.length > 0);
  db.restore();
});

test('runAnalysis rejects invalid input cleanly', async () => {
  const db = installInMemoryDb();
  await assert.rejects(
    runAnalysis(
      {
        source: 'meta',
        campaign: {
          name: '',
          objective: 'sales',
          currency: 'US',
          manualMetrics: { impressions: 0, clicks: 0, spend: 0 }
        }
      },
      user,
      { requestId: 'req-2', userId: user.id }
    ),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 400);
      return true;
    }
  );
  db.restore();
});

test('runAnalysis wraps provider failures without crashing', async () => {
  const db = installInMemoryDb();
  await assert.rejects(
    runAnalysis(
      {
        source: 'meta',
        campaign: {
          name: 'Campaign A',
          objective: 'sales',
          currency: 'USD'
        }
      },
      user,
      { requestId: 'req-3', userId: user.id }
    ),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 500);
      assert.deepEqual(error.details, {
        cause: 'No metrics available. Provide manualMetrics or a valid external campaign id.'
      });
      return true;
    }
  );
  db.restore();
});
