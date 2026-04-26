import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY)

let _accessToken = ''

export function setAccessToken(token: string) {
  _accessToken = token
}

export async function api<T = unknown>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown
): Promise<T> {
  const controller = new AbortController()
  const timeoutId  = setTimeout(() => controller.abort(), 25000)

  try {
    const res = await fetch(`/.netlify/functions/${path}`, {
      method,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(_accessToken ? { Authorization: `Bearer ${_accessToken}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })

    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error((json as { message?: string }).message || `HTTP ${res.status}`)
    return ((json as { data?: T }).data ?? json) as T
  } finally {
    clearTimeout(timeoutId)
  }
}
