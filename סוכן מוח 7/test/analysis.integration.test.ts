import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { createApp } from '../src/server';
import { mockSupabaseJwks, installInMemoryDb } from './helpers';
import { clearSupabaseJwksCache } from '../src/auth/supabaseJwksVerifier';
import { analysisResultCache } from '../src/services/analysisService';
import { buildVersionedKey } from '../src/engine/versioning';
import { stableStringify } from '../src/utils/stableStringify';
import crypto from 'crypto';

function hashInput(input: unknown, userId: string): string {
  return crypto.createHash('sha256').update(`${userId}:${stableStringify(input)}`).digest('hex');
}

async function startApp(): Promise<{ server: Server; baseUrl: string }> {
  const app = createApp();
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

async function postJson(baseUrl: string, token: string, body: unknown) {
  const response = await fetch(`${baseUrl}/api/analysis/run`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });
  const json = await response.json();
  return { response, json };
}

test('POST /analysis runs full auth + user sync + analysis + export flow', async () => {
  const db = installInMemoryDb();
  const jwks = await mockSupabaseJwks();
  clearSupabaseJwksCache();
  analysisResultCache.clear();
  const token = await jwks.issueToken();
  const { server, baseUrl } = await startApp();

  const payload = {
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
  };

  const { response, json } = await postJson(baseUrl, token, payload);
  assert.equal(response.status, 200);
  assert.equal(json.ok, true);
  assert.equal(db.state.users.length, 1);
  assert.equal(db.state.campaigns.length, 1);
  assert.equal(db.state.analysis_results.length, 1);
  assert.ok(json.exported.data);
  assert.ok(db.state.logs.some((row) => row.type === 'analysis_completed'));
  assert.ok(db.state.logs.every((row) => typeof row.request_id === 'string' && row.request_id.length > 0));

  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  jwks.restore();
  clearSupabaseJwksCache();
  db.restore();
});

test('POST /analysis returns cache miss first and cache hit second', async () => {
  const db = installInMemoryDb();
  const jwks = await mockSupabaseJwks();
  clearSupabaseJwksCache();
  analysisResultCache.clear();
  const token = await jwks.issueToken();
  const { server, baseUrl } = await startApp();

  const payload = {
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
  };

  const first = await postJson(baseUrl, token, payload);
  const second = await postJson(baseUrl, token, payload);

  assert.equal(first.json.cached, false);
  assert.equal(second.json.cached, true);
  assert.equal(db.state.analysis_results.length, 1);

  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  jwks.restore();
  clearSupabaseJwksCache();
  db.restore();
});

test('POST /analysis rejects invalid token deterministically', async () => {
  const db = installInMemoryDb();
  const jwks = await mockSupabaseJwks();
  clearSupabaseJwksCache();
  const { server, baseUrl } = await startApp();

  const { response, json } = await postJson(baseUrl, 'not-a-token', {
    source: 'meta',
    campaign: { name: 'x', objective: 'sales', currency: 'USD', manualMetrics: { impressions: 1, clicks: 1, spend: 1 } }
  });

  assert.equal(response.status, 401);
  assert.equal(json.ok, false);
  assert.equal(db.state.users.length, 0);

  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  jwks.restore();
  clearSupabaseJwksCache();
  db.restore();
});

test('POST /analysis rejects malformed input cleanly', async () => {
  const db = installInMemoryDb();
  const jwks = await mockSupabaseJwks();
  clearSupabaseJwksCache();
  const token = await jwks.issueToken();
  const { server, baseUrl } = await startApp();

  const { response, json } = await postJson(baseUrl, token, {
    source: 'meta',
    campaign: { name: '', objective: 'sales', currency: 'US' }
  });

  assert.equal(response.status, 400);
  assert.equal(json.ok, false);

  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  jwks.restore();
  clearSupabaseJwksCache();
  db.restore();
});

test('POST /analysis returns controlled DB failure on saveResult', async () => {
  const db = installInMemoryDb({ failAnalysisInsert: true });
  const jwks = await mockSupabaseJwks();
  clearSupabaseJwksCache();
  const token = await jwks.issueToken();
  const { server, baseUrl } = await startApp();

  const { response, json } = await postJson(baseUrl, token, {
    source: 'meta',
    campaign: {
      name: 'Campaign A',
      objective: 'sales',
      currency: 'USD',
      manualMetrics: { impressions: 100, clicks: 10, spend: 50, landingPageViews: 10, sessions: 8, leads: 1, purchases: 1, revenue: 60 }
    }
  });

  assert.equal(response.status, 503);
  assert.equal(json.ok, false);
  assert.equal(db.state.analysis_results.length, 0);
  assert.ok(db.state.logs.some((row) => row.type === 'analysis_failed'));

  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  jwks.restore();
  clearSupabaseJwksCache();
  db.restore();
});

test('POST /analysis recovers from cache corruption by recomputing', async () => {
  const db = installInMemoryDb();
  const jwks = await mockSupabaseJwks();
  clearSupabaseJwksCache();
  analysisResultCache.clear();
  const token = await jwks.issueToken();
  const { server, baseUrl } = await startApp();

  const payload = {
    source: 'meta',
    campaign: {
      name: 'Campaign A',
      objective: 'sales',
      currency: 'USD',
      manualMetrics: { impressions: 100, clicks: 10, spend: 50, landingPageViews: 10, sessions: 8, leads: 1, purchases: 1, revenue: 60 }
    }
  };
  const inputHash = hashInput(payload, 'user-1');
  analysisResultCache.set(buildVersionedKey(inputHash), { bad: true } as any, inputHash);

  const { response, json } = await postJson(baseUrl, token, payload);
  assert.equal(response.status, 200);
  assert.equal(json.cached, false);
  assert.equal(db.state.analysis_results.length, 1);
  assert.ok(db.state.logs.some((row) => row.type === 'analysis_cache_corrupted'));

  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  jwks.restore();
  clearSupabaseJwksCache();
  db.restore();
});
