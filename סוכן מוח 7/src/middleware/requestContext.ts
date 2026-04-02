import { NextFunction, Request, Response } from 'express';
import { createRequestId } from '../utils/id';

export function requestContext(req: Request, res: Response, next: NextFunction): void {
  req.requestId = createRequestId();
  res.setHeader('x-request-id', req.requestId);
  next();
}
