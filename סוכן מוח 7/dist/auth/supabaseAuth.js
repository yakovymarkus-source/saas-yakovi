"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.signUpWithSupabase = signUpWithSupabase;
exports.signInWithSupabase = signInWithSupabase;
const env_1 = require("../config/env");
const http_1 = require("../utils/http");
async function callSupabaseAuth(path, body) {
    if (!env_1.env.SUPABASE_URL || !env_1.env.SUPABASE_ANON_KEY) {
        throw new http_1.HttpError(500, 'Supabase auth is not configured');
    }
    const response = await fetch(`${env_1.env.SUPABASE_URL}/auth/v1/${path}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            apikey: env_1.env.SUPABASE_ANON_KEY,
            Authorization: `Bearer ${env_1.env.SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify(body)
    });
    const json = (await response.json().catch(() => ({})));
    if (!response.ok) {
        const message = typeof json.msg === 'string'
            ? json.msg
            : typeof json.error_description === 'string'
                ? json.error_description
                : typeof json.error === 'string'
                    ? json.error
                    : 'Supabase auth request failed';
        throw new http_1.HttpError(response.status, message, json);
    }
    return json;
}
async function signUpWithSupabase(email, password) {
    return callSupabaseAuth('signup', { email, password });
}
async function signInWithSupabase(email, password) {
    return callSupabaseAuth('token?grant_type=password', { email, password });
}
