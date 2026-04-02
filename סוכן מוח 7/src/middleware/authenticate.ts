import { NextFunction, Request, Response } from 'express';
import { HttpError } from '../utils/http';
import { syncSupabaseUser } from '../db/usersRepository';
import { verifySupabaseAccessToken } from '../auth/supabaseJwksVerifier';

export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new HttpError(401, 'Missing bearer token');
    }

    req.user = await verifySupabaseAccessToken(header.slice(7));
    await syncSupabaseUser({ id: req.user.id, email: req.user.email });
    next();
  } catch (error) {
    next(error);
  }
}
