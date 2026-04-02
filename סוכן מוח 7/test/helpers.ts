import { exportJWK, generateKeyPair, SignJWT, type JWK, type KeyLike } from 'jose';
import { pool } from '../src/db/client';

export async function mockSupabaseJwks(kid = 'test-key-1'): Promise<{
  issueToken: (claims?: Record<string, unknown>) => Promise<string>;
  restore: () => void;
}> {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const publicJwk = (await exportJWK(publicKey)) as JWK;
  publicJwk.kid = kid;
  publicJwk.alg = 'RS256';
  publicJwk.use = 'sig';

  const originalFetch = global.fetch;
  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/auth/v1/keys')) {
      return new Response(JSON.stringify({ keys: [publicJwk] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    return originalFetch(input as any, init);
  }) as typeof fetch;

  return {
    issueToken: (claims: Record<string, unknown> = {}) => issueSupabaseToken(privateKey, kid, claims),
    restore: () => {
      global.fetch = originalFetch;
    }
  };
}

async function issueSupabaseToken(privateKey: KeyLike, kid: string, claims: Record<string, unknown>): Promise<string> {
  return new SignJWT({
    email: 'user@example.com',
    role: 'authenticated',
    app_metadata: { roles: ['authenticated'], permissions: ['analysis:run'] },
    ...claims
  })
    .setProtectedHeader({ alg: 'RS256', kid })
    .setIssuer('https://example.supabase.co/auth/v1')
    .setSubject(typeof claims.sub === 'string' ? claims.sub : 'user-1')
    .setIssuedAt()
    .setExpirationTime('2h')
    .sign(privateKey);
}

type TableState = {
  users: any[];
  campaigns: any[];
  analysis_results: any[];
  logs: any[];
};

type HarnessOptions = {
  failAnalysisInsert?: boolean;
};

export function installInMemoryDb(options: HarnessOptions = {}): {
  state: TableState;
  restore: () => void;
} {
  const state: TableState = {
    users: [],
    campaigns: [],
    analysis_results: [],
    logs: []
  };

  const originalQuery = pool.query.bind(pool);
  const originalConnect = pool.connect.bind(pool);

  const execute = async (queryText: string, queryParams: unknown[] = []) => {
    const sql = queryText.trim().replace(/\s+/g, ' ');

    if (/^BEGIN$/i.test(sql) || /^COMMIT$/i.test(sql) || /^ROLLBACK$/i.test(sql)) {
      return { rows: [] };
    }

    if (sql.includes('INSERT INTO users')) {
      const [id, email] = queryParams as [string, string];
      const existing = state.users.find((row) => row.id === id);
      const row = {
        id,
        email,
        created_at: existing?.created_at ?? '2026-03-31T00:00:00.000Z',
        updated_at: '2026-03-31T00:00:00.000Z'
      };
      if (existing) {
        Object.assign(existing, row);
      } else {
        state.users.push(row);
      }
      return { rows: [row] };
    }

    if (sql.includes('SELECT id, email, created_at, updated_at FROM users')) {
      const [id] = queryParams as [string];
      return { rows: state.users.filter((row) => row.id === id) };
    }

    if (sql.includes('SELECT * FROM campaigns WHERE user_id =')) {
      const [userId, source, externalId] = queryParams as [string, string, string];
      return { rows: state.campaigns.filter((row) => row.user_id === userId && row.source === source && row.external_id === externalId).slice(0, 1) };
    }

    if (sql.includes('UPDATE campaigns SET')) {
      const [name, objective, currency, payload, id] = queryParams as [string, string, string, string, string];
      const existing = state.campaigns.find((row) => row.id === id);
      if (!existing) return { rows: [] };
      Object.assign(existing, { name, objective, currency, payload: JSON.parse(payload), updated_at: '2026-03-31T00:00:00.000Z' });
      return { rows: [existing] };
    }

    if (sql.includes('INSERT INTO campaigns')) {
      const [id, userId, externalId, name, source, objective, currency, payload] = queryParams as [string, string, string | null, string, string, string, string, string];
      const row = {
        id,
        user_id: userId,
        external_id: externalId,
        name,
        source,
        objective,
        currency,
        payload: JSON.parse(payload),
        created_at: '2026-03-31T00:00:00.000Z',
        updated_at: '2026-03-31T00:00:00.000Z'
      };
      state.campaigns.push(row);
      return { rows: [row] };
    }

    if (sql.includes('INSERT INTO analysis_results')) {
      if (options.failAnalysisInsert) {
        throw new Error('simulated analysis insert failure');
      }
      const [id, userId, campaignId, source, inputHash, engineVersion, result] = queryParams as [string, string, string, string, string, string, string];
      const row = {
        id,
        user_id: userId,
        campaign_id: campaignId,
        source,
        input_hash: inputHash,
        engine_version: engineVersion,
        result: JSON.parse(result),
        created_at: '2026-03-31T00:00:00.000Z'
      };
      state.analysis_results.push(row);
      return { rows: [row] };
    }

    if (sql.includes('INSERT INTO logs')) {
      const [id, requestId, userId, campaignId, analysisId, level, type, message, meta, createdAt] = queryParams as [string, string | null, string | null, string | null, string | null, string, string, string, string, string];
      state.logs.push({
        id,
        request_id: requestId,
        user_id: userId,
        campaign_id: campaignId,
        analysis_id: analysisId,
        level,
        type,
        message,
        meta: JSON.parse(meta),
        created_at: createdAt
      });
      return { rows: [] };
    }

    throw new Error(`Unhandled SQL in test harness: ${sql}`);
  };

  pool.query = (async (queryText: string, queryParams?: unknown[]) => execute(queryText, queryParams)) as typeof pool.query;
  pool.connect = (async () => ({
    query: async (queryText: string, queryParams?: unknown[]) => execute(queryText, queryParams),
    release: () => undefined
  })) as typeof pool.connect;

  return {
    state,
    restore: () => {
      pool.query = originalQuery as typeof pool.query;
      pool.connect = originalConnect as typeof pool.connect;
    }
  };
}
