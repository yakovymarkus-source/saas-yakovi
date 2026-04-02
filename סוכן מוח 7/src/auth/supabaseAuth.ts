import { env } from '../config/env';
import { HttpError } from '../utils/http';

export interface SupabaseAuthResponse {
  access_token: string;
  refresh_token?: string;
  user?: {
    id: string;
    email: string;
  };
}

async function callSupabaseAuth(path: string, body: Record<string, unknown>): Promise<SupabaseAuthResponse> {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    throw new HttpError(500, 'Supabase auth is not configured');
  }

  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`
    },
    body: JSON.stringify(body)
  });

  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const message =
      typeof json.msg === 'string'
        ? json.msg
        : typeof json.error_description === 'string'
          ? json.error_description
          : typeof json.error === 'string'
            ? json.error
            : 'Supabase auth request failed';
    throw new HttpError(response.status, message, json);
  }

  return json as unknown as SupabaseAuthResponse;
}

export async function signUpWithSupabase(email: string, password: string): Promise<SupabaseAuthResponse> {
  return callSupabaseAuth('signup', { email, password });
}

export async function signInWithSupabase(email: string, password: string): Promise<SupabaseAuthResponse> {
  return callSupabaseAuth('token?grant_type=password', { email, password });
}
