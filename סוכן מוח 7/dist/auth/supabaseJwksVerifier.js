"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifySupabaseAccessToken = verifySupabaseAccessToken;
exports.clearSupabaseJwksCache = clearSupabaseJwksCache;
const jose_1 = require("jose");
const env_1 = require("../config/env");
const http_1 = require("../utils/http");
let jwksCache = null;
function getJwksUrl() {
    if (!env_1.env.SUPABASE_URL) {
        throw new http_1.HttpError(500, 'SUPABASE_URL is not configured');
    }
    return `${env_1.env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/keys`;
}
async function fetchJwks(forceRefresh = false) {
    if (!forceRefresh && jwksCache && Date.now() < jwksCache.expiresAt) {
        return jwksCache.jwks;
    }
    const response = await fetch(getJwksUrl(), {
        method: 'GET',
        headers: { Accept: 'application/json' }
    }).catch((error) => {
        throw new http_1.HttpError(502, 'Failed to fetch Supabase JWKS', {
            cause: error instanceof Error ? error.message : 'JWKS request failed'
        });
    });
    const payload = (await response.json().catch(() => ({})));
    if (!response.ok || !Array.isArray(payload.keys) || !payload.keys.length) {
        throw new http_1.HttpError(502, 'Supabase JWKS response is invalid', {
            status: response.status,
            keysPresent: Array.isArray(payload.keys) ? payload.keys.length : 0
        });
    }
    jwksCache = {
        fetchedAt: Date.now(),
        expiresAt: Date.now() + env_1.env.SUPABASE_JWKS_TTL_SECONDS * 1000,
        jwks: payload
    };
    return payload;
}
async function verifyWithJwks(token, jwks) {
    let header;
    try {
        header = (0, jose_1.decodeProtectedHeader)(token);
    }
    catch (error) {
        throw new http_1.HttpError(401, 'Invalid Supabase bearer token', {
            cause: error instanceof Error ? error.message : 'Token header decode failed'
        });
    }
    if (!header.kid) {
        throw new http_1.HttpError(401, 'Invalid Supabase bearer token', { cause: 'Missing token kid header' });
    }
    const keySet = (0, jose_1.createLocalJWKSet)({ keys: jwks.keys ?? [] });
    const issuer = `${env_1.env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1`;
    const { payload } = await (0, jose_1.jwtVerify)(token, keySet, {
        issuer,
        algorithms: ['RS256', 'ES256', 'EdDSA']
    }).catch((error) => {
        throw new http_1.HttpError(401, 'Invalid Supabase bearer token', {
            cause: error instanceof Error ? error.message : 'Token verification failed'
        });
    });
    return payload;
}
async function verifySupabaseAccessToken(token) {
    if (!token || typeof token !== 'string') {
        throw new http_1.HttpError(401, 'Missing bearer token');
    }
    const firstJwks = await fetchJwks(false);
    let payload;
    try {
        payload = await verifyWithJwks(token, firstJwks);
    }
    catch (error) {
        const details = error instanceof http_1.HttpError ? error.details : undefined;
        const reason = typeof details === 'object' && details && 'cause' in details
            ? String(details.cause)
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
        throw new http_1.HttpError(401, 'Invalid Supabase token payload');
    }
    const roles = Array.from(new Set([payload.role, ...(payload.app_metadata?.roles ?? [])].filter(Boolean)));
    return {
        id: userId,
        supabaseUserId: userId,
        email,
        roles,
        permissions: payload.app_metadata?.permissions ?? [],
        token
    };
}
function clearSupabaseJwksCache() {
    jwksCache = null;
}
