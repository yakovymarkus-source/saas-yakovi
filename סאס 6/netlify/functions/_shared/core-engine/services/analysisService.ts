import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { runAnalysis } from '../engine/pipeline';
import { AnalysisRequest, AnalysisResult, AuthenticatedUser } from '../types/domain';
import { buildVersionedKey, ENGINE_VERSION } from '../engine/versioning';
import { HttpError } from '../utils/http';
import { EVENT_DICT_MAP, COMBINATION_INSIGHTS, ALERT_EVENTS } from '../engine/analyticsEventDictionary';

function getDb() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// ── Fetch raw_events for a campaign and build behavioral summary ──────────────
export async function fetchCampaignBehavior(campaignId: string): Promise<BehaviorSummary> {
  const db = getDb();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: events } = await db
    .from('raw_events')
    .select('event_type, session_id, scroll_depth, time_on_page, device_type, ad_id, created_at')
    .eq('campaign_id', campaignId)
    .gte('created_at', since)
    .limit(10000);

  if (!events || events.length === 0) return emptyBehavior(campaignId);

  const sessions = new Set(events.map((e: any) => e.session_id));
  const totalSessions = sessions.size;

  // Count events per type
  const counts: Record<string, number> = {};
  const sessionsByEvent: Record<string, Set<string>> = {};
  events.forEach((e: any) => {
    counts[e.event_type] = (counts[e.event_type] || 0) + 1;
    if (!sessionsByEvent[e.event_type]) sessionsByEvent[e.event_type] = new Set();
    sessionsByEvent[e.event_type].add(e.session_id);
  });

  // Scroll funnel ratios (per session)
  const scrollFunnel = [25, 50, 75, 100].map(pct => ({
    depth: pct,
    sessions: sessionsByEvent[`scroll_${pct}`]?.size || 0,
    ratio: totalSessions > 0 ? ((sessionsByEvent[`scroll_${pct}`]?.size || 0) / totalSessions) : 0,
  }));

  // Device split
  const deviceCounts: Record<string, number> = {};
  events.forEach((e: any) => {
    if (e.device_type) deviceCounts[e.device_type] = (deviceCounts[e.device_type] || 0) + 1;
  });

  // Avg time on page (from time_60s events — proxy for engaged sessions)
  const engagedSessions = sessionsByEvent['time_60s']?.size || 0;

  // Drop-off point: first scroll milestone where ratio drops below 30%
  const dropOffPct = scrollFunnel.find(s => s.ratio < 0.3)?.depth || null;

  // Alerts: check thresholds
  const alerts: string[] = [];
  ALERT_EVENTS.forEach(def => {
    const ratio = totalSessions > 0 ? ((sessionsByEvent[def.event_type]?.size || 0) / totalSessions) : 0;
    if (def.alert_threshold !== undefined && ratio > def.alert_threshold) {
      alerts.push(`${def.event_type} (${Math.round(ratio * 100)}%): ${def.recommended_action}`);
    }
  });

  // Combination insights
  const activeInsights: string[] = [];
  COMBINATION_INSIGHTS.forEach(ci => {
    const hasPrimary   = (sessionsByEvent[ci.primary]?.size   || 0) > 0;
    const hasSecondary = (sessionsByEvent[ci.secondary]?.size || 0) > 0;
    if (hasPrimary && hasSecondary) activeInsights.push(ci.conclusion);
  });

  // Per-ad breakdown
  const adSessions: Record<string, Set<string>> = {};
  const adScrolls: Record<string, number[]> = {};
  events.forEach((e: any) => {
    const adId = e.ad_id || 'unknown';
    if (!adSessions[adId]) adSessions[adId] = new Set();
    adSessions[adId].add(e.session_id);
    if (e.scroll_depth) {
      if (!adScrolls[adId]) adScrolls[adId] = [];
      adScrolls[adId].push(e.scroll_depth);
    }
  });

  const adBreakdown = Object.entries(adSessions).map(([adId, sSet]) => ({
    ad_id: adId,
    sessions: sSet.size,
    avg_scroll: adScrolls[adId]?.length
      ? Math.round(adScrolls[adId].reduce((a, b) => a + b, 0) / adScrolls[adId].length)
      : 0,
    form_submits: events.filter((e: any) => e.ad_id === adId && e.event_type === 'form_submit').length,
  }));

  return {
    campaignId,
    totalSessions,
    scrollFunnel,
    deviceSplit: deviceCounts,
    engagedSessions,
    engagedRatio: totalSessions > 0 ? engagedSessions / totalSessions : 0,
    formStarts:   sessionsByEvent['form_start']?.size   || 0,
    formSubmits:  sessionsByEvent['form_submit']?.size  || 0,
    ctaClicks:    sessionsByEvent['cta_click']?.size    || 0,
    exitIntents:  sessionsByEvent['exit_intent']?.size  || 0,
    rageClicks:   sessionsByEvent['rage_click']?.size   || 0,
    backNavs:     sessionsByEvent['back_navigation']?.size || 0,
    jsErrors:     sessionsByEvent['js_error']?.size     || 0,
    dropOffPct,
    alerts,
    combinationInsights: activeInsights,
    adBreakdown,
  };
}

function emptyBehavior(campaignId: string): BehaviorSummary {
  return {
    campaignId, totalSessions: 0, scrollFunnel: [], deviceSplit: {},
    engagedSessions: 0, engagedRatio: 0, formStarts: 0, formSubmits: 0,
    ctaClicks: 0, exitIntents: 0, rageClicks: 0, backNavs: 0, jsErrors: 0,
    dropOffPct: null, alerts: [], combinationInsights: [], adBreakdown: [],
  };
}

export interface BehaviorSummary {
  campaignId:           string;
  totalSessions:        number;
  scrollFunnel:         { depth: number; sessions: number; ratio: number }[];
  deviceSplit:          Record<string, number>;
  engagedSessions:      number;
  engagedRatio:         number;
  formStarts:           number;
  formSubmits:          number;
  ctaClicks:            number;
  exitIntents:          number;
  rageClicks:           number;
  backNavs:             number;
  jsErrors:             number;
  dropOffPct:           number | null;
  alerts:               string[];
  combinationInsights:  string[];
  adBreakdown:          { ad_id: string; sessions: number; avg_scroll: number; form_submits: number }[];
}

// ── Main analysis entry point ─────────────────────────────────────────────────
export async function executeAnalysis(
  input: AnalysisRequest,
  user: AuthenticatedUser,
  requestId?: string
): Promise<AnalysisResult> {
  if (!input?.campaign) {
    throw new HttpError(400, 'Analysis input is missing campaign payload');
  }

  const analysisId = requestId || crypto.randomUUID();
  const campaignId = input.externalCampaignId || 'ad-hoc';

  // Enrich input with behavioral data from raw_events
  let behavior: BehaviorSummary | null = null;
  try {
    behavior = await fetchCampaignBehavior(campaignId);
    if (behavior.totalSessions > 0) {
      (input as any).behaviorSummary = behavior;
    }
  } catch (err) {
    console.warn('[analysisService] Could not fetch behavior data:', (err as Error).message);
  }

  const engineResult = await runAnalysis(input, user, {
    requestId: analysisId,
    userId: user.id,
    campaignId,
    analysisId,
  });

  // Attach behavioral insights to result
  if (behavior && behavior.totalSessions > 0) {
    (engineResult as any).behaviorSummary  = behavior;
    (engineResult as any).behaviorAlerts   = behavior.alerts;
    (engineResult as any).behaviorInsights = behavior.combinationInsights;
  }

  return {
    analysisId,
    campaignId,
    userId: user.id,
    source: input.source,
    engineVersion: ENGINE_VERSION,
    cached: false,
    createdAt: new Date().toISOString(),
    result: engineResult,
  };
}
