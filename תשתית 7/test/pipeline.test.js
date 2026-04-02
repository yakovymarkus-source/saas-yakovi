const test = require('node:test');
const assert = require('node:assert/strict');
const { runPipeline, sharedCache } = require('../engine/pipeline');
const { handler } = require('../netlify/functions/ai-research');
const { MemoryCache } = require('../engine/cache');

function sampleInput() {
  return {
    cacheTtlMs: 100,
    metaAdsData: [{ key: 'spend', value: 12 }],
    googleAdsData: [{ key: 'clicks', value: 4 }],
    ga4Data: [{ key: 'sessions', value: 7 }]
  };
}

test('pipeline runs end-to-end and validates output', async () => {
  await sharedCache.clear();
  const result = await runPipeline(sampleInput());
  assert.equal(result.status, 'ok');
  assert.equal(result.summary.total_points, 3);
  assert.equal(result.cache_hit, false);
  assert.equal(result.providers.length, 3);
});

test('pipeline returns cache hit on identical input', async () => {
  await sharedCache.clear();
  const first = await runPipeline(sampleInput());
  const second = await runPipeline(sampleInput());
  assert.equal(first.cache_hit, false);
  assert.equal(second.cache_hit, true);
});

test('memory cache invalidates and expires correctly', async () => {
  let now = 0;
  const cache = new MemoryCache({ now: () => now });
  await cache.set('a', { ok: true }, 10);
  assert.deepEqual(await cache.get('a'), { ok: true });
  now = 11;
  assert.equal(await cache.get('a'), null);
  await cache.set('b', { ok: true }, 50);
  await cache.invalidate('b');
  assert.equal(await cache.get('b'), null);
});

test('memory cache concurrent writes keep final stable state', async () => {
  const cache = new MemoryCache();
  await Promise.all([
    cache.set('same', { value: 1 }, 100),
    cache.set('same', { value: 2 }, 100),
    cache.set('same', { value: 3 }, 100)
  ]);
  const value = await cache.get('same');
  assert.ok([1, 2, 3].includes(value.value));
});

test('function handler loads without errors and returns payload', async () => {
  await sharedCache.clear();
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify(sampleInput())
  });

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.success, true);
  assert.equal(payload.data.summary.total_points, 3);
});

test('critical requires resolve', async () => {
  assert.equal(typeof require('../engine/dataFetcher').fetchAllData, 'function');
  assert.equal(typeof require('../netlify/functions/ai-research').handler, 'function');
});
