'use strict';

/**
 * user-intelligence.js — Adaptive user memory layer
 *
 * Stores structured behavioral insights per user in the `user_intelligence`
 * table. All reads/writes are non-blocking with respect to the chat pipeline:
 * reads happen in parallel with other context queries; writes are fire-and-forget.
 *
 * Table schema (Supabase migration required):
 *   user_intelligence (
 *     id          uuid PK DEFAULT gen_random_uuid(),
 *     user_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
 *     category    text NOT NULL CHECK (category IN ('preference','pattern','insight','goal')),
 *     key         text NOT NULL,
 *     value       jsonb NOT NULL DEFAULT '{}',
 *     confidence  numeric(3,2) NOT NULL DEFAULT 0.5,
 *     updated_at  timestamptz NOT NULL DEFAULT now(),
 *     UNIQUE (user_id, category, key)
 *   );
 *   CREATE INDEX idx_user_intelligence_user ON user_intelligence(user_id);
 */

const { getAdminClient } = require('./supabase');

const VALID_CATEGORIES = new Set(['preference', 'pattern', 'insight', 'goal']);

// Business type keyword signals — detected from free-text messages
const BUSINESS_TYPE_SIGNALS = {
  ecommerce:        /\b(חנות|מוצר|קנייה|רכישה|ecommerce|shop|store|product|purchase)\b/i,
  services:         /\b(שירות|ייעוץ|לקוח|פגישה|טיפול|service|consult|appointment|client)\b/i,
  lead_generation:  /\b(ליד|טופס|פנייה|lead|form|inquiry|contact)\b/i,
};

// ── Read ──────────────────────────────────────────────────────────────────────

/**
 * loadUserMemory(userId) → raw memory map grouped by category.
 * Returns {} on any DB error — caller must handle missing keys gracefully.
 */
async function loadUserMemory(userId) {
  try {
    const { data, error } = await getAdminClient()
      .from('user_intelligence')
      .select('category, key, value, confidence')
      .eq('user_id', userId);

    if (error) {
      console.warn('[user-intelligence] load failed:', error.message);
      return {};
    }

    const memory = {};
    for (const row of (data || [])) {
      if (!memory[row.category]) memory[row.category] = {};
      memory[row.category][row.key] = { value: row.value, confidence: row.confidence };
    }
    return memory;
  } catch (e) {
    console.warn('[user-intelligence] load exception:', e.message);
    return {};
  }
}

// ── Derive ────────────────────────────────────────────────────────────────────

/**
 * deriveAdaptiveContext(memory) → clean adaptive context shape.
 * All fields are nullable — callers must check before using.
 */
function deriveAdaptiveContext(memory) {
  const get = (cat, key) => memory?.[cat]?.[key]?.value ?? null;

  return {
    // Array of intents sorted by frequency: ['budget','roas','ctr']
    preferredFocus:  get('preference', 'focus_area')       || [],
    // 'growing' | 'optimizing' | 'struggling' | 'starting'
    campaignStage:   get('insight',    'campaign_stage')   || null,
    // {key:'low_ctr', count:4, last_seen:'2026-04-01'}
    recurringIssue:  get('insight',    'recurring_issue')  || null,
    // 'ecommerce' | 'services' | 'lead_generation'
    businessType:    get('goal',       'business_type')    || null,
    // Raw frequency map: {budget:5, roas:3}
    intentHistory:   get('pattern',    'intent_history')   || {},
    // Phase 4E: {current:'connect'|'analyze'|'fix_top_issue'|'track_result'|'graduated',
    //            completed:[], overthink_count:0, fix_issue_label:null, tracking_started:null}
    milestoneProgress: get('pattern',  'milestone_progress') || null,
  };
}

// ── Write ─────────────────────────────────────────────────────────────────────

async function upsertMemoryEntry(userId, category, key, value, confidence = 0.7) {
  if (!VALID_CATEGORIES.has(category)) return;
  try {
    await getAdminClient()
      .from('user_intelligence')
      .upsert(
        { user_id: userId, category, key, value, confidence, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,category,key' }
      );
  } catch (e) {
    console.warn('[user-intelligence] upsert exception:', e.message);
  }
}

// ── Learn ─────────────────────────────────────────────────────────────────────

/**
 * updateIntelligenceFromInteraction(userId, { intent, message, engineResult, globalRaw })
 *
 * Called fire-and-forget after every chat response. Never throws.
 * Updates: intent histogram → preferred focus → recurring issue → campaign stage → business type.
 */
async function updateIntelligenceFromInteraction(userId, { intent, message = '', engineResult = null, globalRaw = null }) {
  try {
    const sb = getAdminClient();

    // ── 1. Intent frequency histogram ────────────────────────────────────────
    const { data: intentRow } = await sb
      .from('user_intelligence')
      .select('value')
      .eq('user_id', userId)
      .eq('category', 'pattern')
      .eq('key', 'intent_history')
      .maybeSingle();

    const intentHistory = (intentRow?.value && typeof intentRow.value === 'object')
      ? intentRow.value
      : {};
    intentHistory[intent] = (intentHistory[intent] || 0) + 1;
    await upsertMemoryEntry(userId, 'pattern', 'intent_history', intentHistory, 0.95);

    // ── 2. Derive preferred focus (top 3 intents) ────────────────────────────
    const focusArea = Object.entries(intentHistory)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k]) => k);
    await upsertMemoryEntry(userId, 'preference', 'focus_area', focusArea, 0.85);

    // ── 3. Recurring issue from decision engine ───────────────────────────────
    if (engineResult?.issues?.[0]) {
      const topKey = engineResult.issues[0].dict_key || engineResult.issues[0].reason || null;
      if (topKey) {
        const { data: issueRow } = await sb
          .from('user_intelligence')
          .select('value')
          .eq('user_id', userId)
          .eq('category', 'insight')
          .eq('key', 'recurring_issue')
          .maybeSingle();

        const current   = (issueRow?.value && typeof issueRow.value === 'object') ? issueRow.value : {};
        const sameIssue = current.key === topKey;
        const count     = sameIssue ? (current.count || 0) + 1 : 1;
        const confidence = Math.min(0.4 + count * 0.12, 0.95);
        await upsertMemoryEntry(userId, 'insight', 'recurring_issue', {
          key:       topKey,
          count,
          last_seen: new Date().toISOString().slice(0, 10),
        }, confidence);
      }
    }

    // ── 4. Campaign stage from live metrics ───────────────────────────────────
    if (globalRaw && (globalRaw.clicks > 0 || globalRaw.impressions > 0)) {
      const roas = globalRaw.spend > 0 ? globalRaw.revenue / globalRaw.spend : 0;
      const ctr  = globalRaw.impressions > 0 ? globalRaw.clicks / globalRaw.impressions : 0;
      let stage  = 'optimizing';
      if (globalRaw.spend < 50)             stage = 'starting';
      else if (roas >= 3 && ctr >= 0.02)    stage = 'growing';
      else if (roas < 1 || ctr < 0.005)     stage = 'struggling';
      await upsertMemoryEntry(userId, 'insight', 'campaign_stage', stage, 0.65);
    }

    // ── 5. Business type inference from message keywords ─────────────────────
    if (message) {
      for (const [type, pattern] of Object.entries(BUSINESS_TYPE_SIGNALS)) {
        if (pattern.test(message)) {
          // Only set if not already set with high confidence
          const { data: btRow } = await sb
            .from('user_intelligence')
            .select('value, confidence')
            .eq('user_id', userId)
            .eq('category', 'goal')
            .eq('key', 'business_type')
            .maybeSingle();

          const existingConf = btRow?.confidence || 0;
          if (existingConf < 0.8) {
            await upsertMemoryEntry(userId, 'goal', 'business_type', type, 0.65);
          }
          break;
        }
      }
    }

  } catch (e) {
    // Always swallow — memory writes must never break the chat response
    console.warn('[user-intelligence] interaction update failed:', e.message);
  }
}

module.exports = {
  loadUserMemory,
  deriveAdaptiveContext,
  upsertMemoryEntry,
  updateIntelligenceFromInteraction,
};
