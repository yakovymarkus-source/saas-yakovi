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
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return callSupabaseAuth('signup', { email, password });
  }

  // Use admin API so the user is confirmed immediately — no email verification needed
  const adminRes = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
    },
    body: JSON.stringify({ email, password, email_confirm: true })
  });

  const adminJson = (await adminRes.json().catch(() => ({}))) as Record<string, unknown>;

  if (!adminRes.ok) {
    const msg =
      typeof adminJson.msg === 'string' ? adminJson.msg :
      typeof adminJson.error_description === 'string' ? adminJson.error_description :
      typeof adminJson.message === 'string' ? adminJson.message :
      'Registration failed';
    throw new HttpError(adminRes.status, msg, adminJson);
  }

  // Sign in immediately to get the access token
  return callSupabaseAuth('token?grant_type=password', { email, password });
}

export async function signInWithSupabase(email: string, password: string): Promise<SupabaseAuthResponse> {
  try {
    return await callSupabaseAuth('token?grant_type=password', { email, password });
  } catch (err) {
    if (err instanceof HttpError && err.status === 400) {
      throw new HttpError(401, 'אימייל או סיסמה שגויים', {});
    }
    throw err;
  }
}
