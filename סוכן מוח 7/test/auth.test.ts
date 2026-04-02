import test from 'node:test';
import assert from 'node:assert/strict';
import { clearSupabaseJwksCache, verifySupabaseAccessToken } from '../src/auth/supabaseJwksVerifier';
import { HttpError } from '../src/utils/http';
import { mockSupabaseJwks } from './helpers';

test('auth verification flow extracts the Supabase user correctly', async () => {
  const jwks = await mockSupabaseJwks();
  clearSupabaseJwksCache();
  const token = await jwks.issueToken({ sub: 'user-1', email: 'USER@EXAMPLE.COM' });

  const user = await verifySupabaseAccessToken(token);
  assert.equal(user.id, 'user-1');
  assert.equal(user.email, 'user@example.com');
  assert.deepEqual(user.roles, ['authenticated']);
  assert.deepEqual(user.permissions, ['analysis:run']);

  jwks.restore();
  clearSupabaseJwksCache();
});

test('auth verification rejects an invalid token', async () => {
  const jwks = await mockSupabaseJwks();
  clearSupabaseJwksCache();

  await assert.rejects(verifySupabaseAccessToken('bad-token'), (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.status, 401);
    return true;
  });

  jwks.restore();
  clearSupabaseJwksCache();
});
