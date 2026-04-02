import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { HttpError } from '../utils/http';
import { writeOperationalLog } from '../utils/logger';

export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction): void {
  const message = error instanceof Error ? error.message : 'Unknown error';

  writeOperationalLog({
    level: 'error',
    type: 'request_failed',
    message,
    requestId: req.requestId,
    userId: req.user?.id,
    meta: {
      path: req.path,
      method: req.method,
      errorName: error instanceof Error ? error.name : 'UnknownError'
    }
  });

  if (error instanceof ZodError) {
    res.status(400).json({ ok: false, error: 'VALIDATION_ERROR', details: error.flatten(), requestId: req.requestId });
    return;
  }
  if (error instanceof HttpError) {
    res.status(error.status).json({ ok: false, error: error.message, details: error.details, requestId: req.requestId });
    return;
  }
  res.status(500).json({ ok: false, error: 'INTERNAL_SERVER_ERROR', message, requestId: req.requestId });
}
