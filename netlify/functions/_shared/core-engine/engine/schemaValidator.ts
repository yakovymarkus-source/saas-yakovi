import { ZodType } from 'zod';
import { HttpError } from '../utils/http';

export function validateWithSchema<T>(schema: ZodType<T>, value: unknown, label: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new HttpError(400, `${label} validation failed`, {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message
      }))
    });
  }
  return parsed.data as T;
}
