import { Router } from 'express';
import { authSchema } from '../auth/schemas';
import { signInWithSupabase, signUpWithSupabase } from '../auth/supabaseAuth';
import { syncSupabaseUser } from '../db/usersRepository';
import { HttpError } from '../utils/http';

export const authRoutes = Router();

async function persistSupabaseUser(auth: Awaited<ReturnType<typeof signUpWithSupabase>>): Promise<void> {
  if (!auth.user?.id || !auth.user.email) return;
  // Fire-and-forget — DB sync failure must not block auth
  syncSupabaseUser({ id: auth.user.id, email: auth.user.email }).catch(() => undefined);
}

authRoutes.post('/register', async (req, res, next) => {
  try {
    const payload = authSchema.parse(req.body);
    const auth = await signUpWithSupabase(payload.email, payload.password);
    await persistSupabaseUser(auth);
    res.status(201).json({
      ok: true,
      token: auth.access_token,
      refreshToken: auth.refresh_token ?? null,
      user: auth.user ?? null
    });
  } catch (error) {
    next(error);
  }
});

authRoutes.post('/login', async (req, res, next) => {
  try {
    const payload = authSchema.parse(req.body);
    const auth = await signInWithSupabase(payload.email, payload.password);
    await persistSupabaseUser(auth);
    res.json({
      ok: true,
      token: auth.access_token,
      refreshToken: auth.refresh_token ?? null,
      user: auth.user ?? null
    });
  } catch (error) {
    next(error);
  }
});
