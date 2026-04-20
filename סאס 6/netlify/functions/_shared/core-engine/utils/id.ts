import crypto from 'crypto';

export function createId(): string {
  return crypto.randomUUID();
}

export function createRequestId(): string {
  return crypto.randomBytes(8).toString('hex');
}
