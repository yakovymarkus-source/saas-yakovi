import test from 'node:test';
import assert from 'node:assert/strict';
import { syncSupabaseUser } from '../src/db/usersRepository';
import { installInMemoryDb } from './helpers';

test('syncSupabaseUser upserts the Supabase user profile using normalized email', async () => {
  const db = installInMemoryDb();
  const user = await syncSupabaseUser({ id: 'user-1', email: 'USER@EXAMPLE.COM' });
  assert.equal(user.email, 'user@example.com');
  assert.equal(db.state.users.length, 1);
  assert.equal(db.state.users[0].id, 'user-1');
  db.restore();
});
