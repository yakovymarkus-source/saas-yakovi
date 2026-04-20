import { UserRecord } from '../types/domain';
import { pool, type DbExecutor, queryDb } from './client';
import { HttpError } from '../utils/http';

export async function syncSupabaseUser(input: { id: string; email: string }, executor: DbExecutor = pool): Promise<UserRecord> {
  const id = input.id?.trim();
  const email = input.email?.trim().toLowerCase();
  if (!id || !email) {
    throw new HttpError(400, 'Supabase user identity is incomplete');
  }

  const { rows } = await queryDb<UserRecord>(
    executor,
    `INSERT INTO users (id, email)
     VALUES ($1, $2)
     ON CONFLICT (id)
     DO UPDATE SET email = EXCLUDED.email, updated_at = NOW()
     RETURNING id, email, created_at, updated_at`,
    [id, email]
  );

  return rows[0];
}

export async function findUserById(id: string, executor: DbExecutor = pool): Promise<UserRecord | null> {
  const { rows } = await queryDb<UserRecord>(
    executor,
    `SELECT id, email, created_at, updated_at FROM users WHERE id = $1 LIMIT 1`,
    [id]
  );
  return rows[0] ?? null;
}
