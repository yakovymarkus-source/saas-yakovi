import { createLocalJWKSet, decodeProtectedHeader, jwtVerify, type JWTPayload, type JWK } from 'jose';
import { env } from '../config/env';
import { HttpError } from '../utils/http';
import { AuthenticatedUser } from '../types/domain';

export type SupabaseJwtPayload = JWTPayload & {
  email?: string;
  role?: string;
  app_metadata?: { roles?: string[]; permissions?: string[] };
  user_metadata?: Record<string, unknown>;
};

type JwksResponse = {
  keys?: JWK[];
};

type CachedJwks = {
  fetchedAt: number;
  expiresAt: number;
  jwks: JwksResponse;
};

let jwksCache: CachedJwks | null = null;

function getJwksUrl(): string {
  if (!env.SUPABASE_URL) {
    throw new HttpError(500, 'SUPABASE_URL is not configured');
  }
  return `${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/keys`;
}

async function fetchJwks(forceRefresh = false): Promise<JwksResponse> {
  if (!forceRefresh && jwksCache && Date.now() < jwksCache.expiresAt) {
    return jwksCache.jwks;
  }

  const response = await fetch(getJwksUrl(), {
    method: 'GET',
    headers: { Accept: 'application/json' }
  }).catch((error) => {
    throw new HttpError(502, 'Failed to fetch Supabase JWKS', {
      cause: error instanceof Error ? error.message : 'JWKS request failed'
    });
  });

  const payload = (await response.json().catch(() => ({}))) as JwksResponse;
  if (!response.ok || !Array.isArray(payload.keys) || !payload.keys.length) {
    throw new HttpError(502, 'Supabase JWKS response is invalid', {
      status: response.status,
      keysPresent: Array.isArray(payload.keys) ? payload.keys.length : 0
    });
  }

  jwksCache = {
    fetchedAt: Date.now(),
    expiresAt: Date.now() + env.SUPABASE_JWKS_TTL_SECONDS * 1000,
    jwks: payload
  };

  return payload;
}

async function verifyWithJwks(token: string, jwks: JwksResponse): Promise<SupabaseJwtPayload> {
  let header: ReturnType<typeof decodeProtectedHeader>;
  try {
    header = decodeProtectedHeader(token);
  } catch (error) {
    throw new HttpError(401, 'Invalid Supabase bearer token', {
      cause: error instanceof Error ? error.message : 'Token header decode failed'
    });
  }

  if (!header.kid) {
    throw new HttpError(401, 'Invalid Supabase bearer token', { cause: 'Missing token kid header' });
  }

  const keySet = createLocalJWKSet({ keys: jwks.keys ?? [] });
  const issuer = `${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1`;

  const { payload } = await jwtVerify(token, keySet, {
    issuer,
    algorithms: ['RS256', 'ES256', 'EdDSA']
  }).catch((error) => {
    throw new HttpError(401, 'Invalid Supabase bearer token', {
      cause: error instanceof Error ? error.message : 'Token verification failed'
    });
  });

  return payload as SupabaseJwtPayload;
}

export async function verifySupabaseAccessToken(token: string): Promise<AuthenticatedUser> {
  if (!token || typeof token !== 'string') {
    throw new HttpError(401, 'Missing bearer token');
  }

  const firstJwks = await fetchJwks(false);
  let payload: SupabaseJwtPayload;

  try {
    payload = await verifyWithJwks(token, firstJwks);
  } catch (error) {
    const details = error instanceof HttpError ? error.details : undefined;
    const reason = typeof details === 'object' && details && 'cause' in (details as Record<string, unknown>)
      ? String((details as Record<string, unknown>).cause)
      : '';

    const shouldRefresh = /no applicable key|no matching|unknown kid|key/i.test(reason);
    if (!shouldRefresh) {
      throw error;
    }

    const refreshed = await fetchJwks(true);
    payload = await verifyWithJwks(token, refreshed);
  }

  const userId = typeof payload.sub === 'string' ? payload.sub : '';
  const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : '';
  if (!userId || !email) {
    throw new HttpError(401, 'Invalid Supabase token payload');
  }

  const roles = Array.from(new Set([payload.role, ...(payload.app_metadata?.roles ?? [])].filter(Boolean) as string[]));

  return {
    id: userId,
    supabaseUserId: userId,
    email,
    roles,
    permissions: payload.app_metadata?.permissions ?? [],
    token
  };
}

export function clearSupabaseJwksCache(): void {
  jwksCache = null;
}
