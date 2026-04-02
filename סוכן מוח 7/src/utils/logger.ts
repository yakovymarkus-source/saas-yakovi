import { saveLog } from '../db/logsRepository';

export interface LogPayload {
  level: 'info' | 'error';
  type: string;
  message: string;
  requestId?: string;
  userId?: string;
  campaignId?: string;
  analysisId?: string;
  meta?: Record<string, unknown>;
}

function writeStructuredLine(payload: Record<string, unknown>, level: 'info' | 'error'): void {
  const line = `${JSON.stringify(payload)}\n`;
  if (level === 'error') {
    process.stderr.write(line);
    return;
  }
  process.stdout.write(line);
}

export async function logEvent(input: LogPayload): Promise<void> {
  const payload = {
    timestamp: new Date().toISOString(),
    ...input,
    meta: input.meta ?? {}
  };

  writeStructuredLine(payload, input.level);
  await saveLog(payload);
}

export function writeOperationalLog(input: LogPayload & { timestamp?: string }): void {
  writeStructuredLine(
    {
      timestamp: input.timestamp ?? new Date().toISOString(),
      ...input,
      meta: input.meta ?? {}
    },
    input.level
  );
}
