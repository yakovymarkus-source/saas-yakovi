import { AnalysisResult, ExportedAnalysisPayload } from '../types/domain';
import { featureFlags } from '../config/featureFlags';
import { stableStringify } from '../utils/stableStringify';
import { HttpError } from '../utils/http';
import { logEvent } from '../utils/logger';

function sanitizeForExport(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => sanitizeForExport(item, seen));
  if (typeof value === 'object') {
    if (seen.has(value as object)) {
      throw new HttpError(500, 'Analysis export failed because payload is circular');
    }
    seen.add(value as object);
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const sanitized = sanitizeForExport((value as Record<string, unknown>)[key], seen);
      output[key] = sanitized ?? null;
    }
    seen.delete(value as object);
    return output;
  }
  return String(value);
}

function assertExportableAnalysisResult(result: AnalysisResult): void {
  if (!result?.analysisId || !result?.campaignId || !result?.userId || !result?.engineVersion || !result?.result) {
    throw new HttpError(500, 'Analysis export failed because result is incomplete');
  }
}

export function exportAnalysisResult(
  result: AnalysisResult,
  context: { requestId?: string; userId?: string; campaignId?: string; analysisId?: string } = {}
): ExportedAnalysisPayload | null {
  if (!featureFlags.enableAnalysisExport) return null;

  assertExportableAnalysisResult(result);

  const exportable = sanitizeForExport({
    analysisId: result.analysisId,
    campaignId: result.campaignId,
    userId: result.userId,
    source: result.source,
    engineVersion: result.engineVersion,
    cached: result.cached,
    createdAt: result.createdAt,
    result: result.result
  });

  const data = stableStringify(exportable);

  void logEvent({
    level: 'info',
    type: 'analysis_export_generated',
    message: 'Analysis export generated',
    requestId: context.requestId,
    userId: context.userId,
    campaignId: context.campaignId,
    analysisId: context.analysisId,
    meta: { bytes: Buffer.byteLength(data, 'utf8'), engineVersion: result.engineVersion }
  }).catch(() => undefined);

  return {
    format: 'json',
    fileName: `analysis-${result.analysisId}.json`,
    contentType: 'application/json',
    data
  };
}
