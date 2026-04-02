import test from 'node:test';
import assert from 'node:assert/strict';
import { TtlCache } from '../src/utils/cache';
import { buildVersionedKey } from '../src/engine/versioning';

test('cache version key behavior is isolated by engine version', async () => {
  const key = buildVersionedKey('abc123');
  assert.equal(key, '1.0.0:abc123');

  const cacheV1 = new TtlCache<string>(60, '1.0.0');
  const cacheV2 = new TtlCache<string>(60, '2.0.0');
  cacheV1.set(key, 'cached-result', 'abc123');

  assert.equal(cacheV1.get(key), 'cached-result');
  assert.equal(cacheV2.get(key), null);
});
