'use strict';

/**
 * feedback-loop.js — Asset Feedback & Learning Loop
 *
 * Processes explicit user feedback on generated assets and writes structured
 * signals into user_intelligence so future generations improve.
 *
 * EVENTS:
 *   'approved' — user accepted / downloaded the output
 *   'rejected' — user rejected / asked to regenerate
 *   'edited'   — user described specific changes they want
 *   'viewed'   — user opened the preview (weak signal)
 *
 * KEYS WRITTEN TO user_intelligence:
 *   preference / approved_templates   — histogram: { template_id: count }
 *   preference / rejected_templates   — array of { template_id, asset_type, reason, count }
 *   preference / preferred_styles     — { asset_type, tone_preference, last_approved_at }
 *   pattern   / asset_feedback_history — { total, approved, rejected, viewed, edited, last_event }
 *   insight   / last_generated_asset  — { asset_id, template_id, asset_type, generated_at }
 *   insight   / repeated_rejection    — { template_id, count, last_rejected } (confidence grows with count)
 *
 * CLOSED LOOP:
 *   generateHTML → saveAsset → store last_generated_asset
 *   user approves/rejects → learnFromFeedback → update user_intelligence
 *   next generateHTML → buildMarketingMemory reads user_intelligence
 *   → approved_patterns, forbidden_styles, layout_preferences.preferred_template change
 *
 * All writes are fire-and-forget safe — never throws.
 */

const { getAdminClient }   = require('./supabase');
const { upsertMemoryEntry, loadUserMemory } = require('./user-intelligence');

// ── Constants ─────────────────────────────────────────────────────────────────

const VALID_EVENTS = new Set(['approved', 'rejected', 'edited', 'viewed']);
const UUID_RE      = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Minimum rejections before a template is treated as 'forbidden'
const REJECTION_THRESHOLD = 2;

// ─────────────────────────────────────────────────────────────────────────────
// learnFromFeedback — main entry
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {string} userId
 * @param {string} assetId  — UUID of the generated asset
 * @param {string} event    — 'approved' | 'rejected' | 'edited' | 'viewed'
 * @param {object} details
 *   reason    {string?} — why rejected: 'too_generic' | 'wrong_style' | 'wrong_cta' | 'too_long' | 'too_short' | 'other'
 *   editNote  {string?} — free-text description of desired change
 *   assetMeta {object?} — { template_id, asset_type } — if pre-known, skip DB lookup
 */
async function learnFromFeedback(userId, assetId, event, details = {}) {
  if (!userId || !UUID_RE.test(userId))  return;
  if (!assetId || !UUID_RE.test(assetId)) return;
  if (!VALID_EVENTS.has(event)) return;

  try {
    // ── Resolve asset metadata ────────────────────────────────────────────────
    let templateId = details.assetMeta?.template_id || null;
    let assetType  = details.assetMeta?.asset_type  || null;

    if (!templateId || !assetType) {
      const { data } = await getAdminClient()
        .from('generated_assets')
        .select('type, template_id, metadata')
        .eq('id', assetId)
        .eq('user_id', userId)   // ownership check
        .maybeSingle();

      if (data) {
        templateId = templateId || data.template_id || null;
        assetType  = assetType  || data.type        || null;
      }
    }

    // ── Load current memory (all at once to avoid multiple round-trips) ───────
    const memory = await loadUserMemory(userId);
    const get    = (cat, key) => memory?.[cat]?.[key]?.value ?? null;

    // ── 1. Update feedback history counter ───────────────────────────────────
    const history = get('pattern', 'asset_feedback_history') || {};
    history.total    = (history.total    || 0) + 1;
    history[event]   = (history[event]   || 0) + 1;
    history.last_event = { event, asset_id: assetId, at: new Date().toISOString() };
    await upsertMemoryEntry(userId, 'pattern', 'asset_feedback_history', history, 0.95);

    // ── 2. Event-specific learning ────────────────────────────────────────────

    if (event === 'approved' && templateId) {
      // Increment approved_templates histogram
      const approvedTemplates = get('preference', 'approved_templates') || {};
      approvedTemplates[templateId] = (approvedTemplates[templateId] || 0) + 1;
      await upsertMemoryEntry(userId, 'preference', 'approved_templates', approvedTemplates, 0.85);

      // Update preferred_styles
      const preferredStyles = get('preference', 'preferred_styles') || {};
      preferredStyles.most_approved_type     = _topKey({ ...(preferredStyles._type_counts || {}), [assetType]: (preferredStyles._type_counts?.[assetType] || 0) + 1 });
      preferredStyles._type_counts           = { ...(preferredStyles._type_counts || {}), [assetType]: (preferredStyles._type_counts?.[assetType] || 0) + 1 };
      preferredStyles.most_approved_template = _topKey(approvedTemplates);
      preferredStyles.last_approved_at       = new Date().toISOString();
      await upsertMemoryEntry(userId, 'preference', 'preferred_styles', preferredStyles, 0.80);

      // If this template had a repeated_rejection record, reduce its confidence
      const repRej = get('insight', 'repeated_rejection') || {};
      if (repRej.template_id === templateId && (repRej.count || 0) > 0) {
        repRej.count = Math.max(0, (repRej.count || 1) - 1);
        const conf = Math.max(0.1, Math.min(0.4 + repRej.count * 0.12, 0.95));
        await upsertMemoryEntry(userId, 'insight', 'repeated_rejection', repRej, conf);
      }
    }

    if (event === 'rejected' && templateId) {
      // Update rejected_templates list
      const rejectedTemplates = get('preference', 'rejected_templates') || [];
      const existing = rejectedTemplates.find(r => r.template_id === templateId && r.asset_type === assetType);
      if (existing) {
        existing.count++;
        existing.last_rejected = new Date().toISOString();
        if (details.reason && details.reason !== 'other') existing.reason = details.reason;
      } else {
        rejectedTemplates.push({
          template_id:   templateId,
          asset_type:    assetType   || null,
          reason:        details.reason || 'unspecified',
          count:         1,
          last_rejected: new Date().toISOString(),
        });
      }
      // Cap list at 20 entries — keep highest count ones
      rejectedTemplates.sort((a, b) => b.count - a.count);
      const trimmed = rejectedTemplates.slice(0, 20);
      const rejConf = Math.min(0.5 + (existing?.count || 1) * 0.1, 0.9);
      await upsertMemoryEntry(userId, 'preference', 'rejected_templates', trimmed, rejConf);

      // Update repeated_rejection insight
      const repRej    = get('insight', 'repeated_rejection') || {};
      const sameEntry = repRej.template_id === templateId;
      const newCount  = sameEntry ? (repRej.count || 0) + 1 : 1;
      if (newCount >= 1) {
        const conf = Math.min(0.4 + newCount * 0.12, 0.95);
        await upsertMemoryEntry(userId, 'insight', 'repeated_rejection', {
          template_id:   templateId,
          asset_type:    assetType || null,
          reason:        details.reason || repRej.reason || null,
          count:         newCount,
          last_rejected: new Date().toISOString(),
        }, conf);
      }
    }

    if (event === 'edited') {
      // Track what aspects get edited most (weak preference signal)
      const editPatterns = get('insight', 'edit_patterns') || {};
      const note = (details.editNote || '').toLowerCase();
      const aspect = _detectEditAspect(note);
      if (aspect) {
        editPatterns[aspect] = (editPatterns[aspect] || 0) + 1;
        editPatterns.last_edit_at = new Date().toISOString();
        await upsertMemoryEntry(userId, 'insight', 'edit_patterns', editPatterns, 0.70);
      }
    }

  } catch (err) {
    // Always swallow — feedback writes must never break anything
    console.warn('[feedback-loop] learnFromFeedback failed:', err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// storeLastGeneratedAsset — call after saveAsset() to enable feedback reference
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stores a reference to the most recently generated asset.
 * Used so the chat handler can look up `last_generated_asset` when the user
 * sends an approval or rejection without specifying the asset_id explicitly.
 *
 * @param {string} userId
 * @param {object} assetInfo  — { asset_id, template_id, asset_type }
 */
async function storeLastGeneratedAsset(userId, assetInfo) {
  try {
    await upsertMemoryEntry(userId, 'insight', 'last_generated_asset', {
      asset_id:     assetInfo.asset_id,
      template_id:  assetInfo.template_id || null,
      asset_type:   assetInfo.asset_type  || null,
      generated_at: new Date().toISOString(),
    }, 0.99);
  } catch (err) {
    console.warn('[feedback-loop] storeLastGeneratedAsset failed:', err.message);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _topKey(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const entries = Object.entries(obj).filter(([, v]) => typeof v === 'number');
  if (!entries.length) return null;
  return entries.sort((a, b) => b[1] - a[1])[0][0];
}

function _detectEditAspect(note) {
  if (/כותרת|headline|h1|כותרת ראשית/i.test(note))           return 'headline';
  if (/cta|כפתור|פעולה|לחצן/i.test(note))                     return 'cta';
  if (/צבע|color|עיצוב|design/i.test(note))                   return 'color';
  if (/ארוך|קצר|length|size|סקשן|section/i.test(note))        return 'length';
  if (/תמונה|image|photo|img/i.test(note))                    return 'image';
  if (/טקסט|text|copy|תוכן|content/i.test(note))             return 'copy';
  return 'other';
}

// ─────────────────────────────────────────────────────────────────────────────
module.exports = { learnFromFeedback, storeLastGeneratedAsset, REJECTION_THRESHOLD };
