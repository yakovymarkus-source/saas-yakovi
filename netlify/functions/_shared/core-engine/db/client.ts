// Stub — DB access uses Supabase in Netlify; pg pool not available
export type DbExecutor = { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> };

const noopExecutor: DbExecutor = {
  query: async () => ({ rows: [] }),
};

export const pool = noopExecutor;

export async function queryDb(executor: DbExecutor, sql: string, params?: unknown[]): Promise<{ rows: unknown[] }> {
  return executor.query(sql, params);
}

export async function withTransaction<T>(fn: (client: DbExecutor) => Promise<T>): Promise<T> {
  return fn(noopExecutor);
}
