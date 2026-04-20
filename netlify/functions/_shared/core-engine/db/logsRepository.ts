// Supabase-compatible log persistence (fire-and-forget)
import { createClient } from '@supabase/supabase-js';

function getDb() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY!
  );
}

export async function saveLog(input: {
  level: string;
  type: string;
  message: string;
  requestId?: string;
  userId?: string;
  campaignId?: string;
  analysisId?: string;
  meta: Record<string, unknown>;
  timestamp: string;
}): Promise<void> {
  try {
    const db = getDb();
    await db.from('logs').insert({
      request_id: input.requestId || null,
      user_id: input.userId || null,
      campaign_id: input.campaignId || null,
      analysis_id: input.analysisId || null,
      level: input.level,
      type: input.type,
      message: input.message,
      meta: input.meta,
      created_at: input.timestamp,
    });
  } catch {
    // fire-and-forget — log errors must not break the main flow
  }
}
