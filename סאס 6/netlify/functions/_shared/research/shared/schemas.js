'use strict';
/**
 * Shared Output Contract schemas and validators for the research agent.
 */

const SIGNAL_TYPES      = ['pain', 'fear', 'desire', 'frustration', 'trigger', 'language', 'belief'];
const ENTITY_PRIORITIES = ['high', 'medium', 'low'];
const INSIGHT_TYPES     = ['pattern', 'gap', 'opportunity'];
const DEPTH_LEVELS      = ['low', 'medium', 'high'];
const JOB_STATUSES      = ['pending', 'running', 'completed', 'failed', 'cancelled'];

function validateEntity(e) {
  if (!e || typeof e.name !== 'string' || !e.name.trim()) return false;
  if (e.confidence !== undefined && (e.confidence < 0 || e.confidence > 100)) return false;
  if (e.priority && !ENTITY_PRIORITIES.includes(e.priority)) return false;
  return true;
}

function validateSignal(s) {
  if (!s || typeof s.text !== 'string' || !s.text.trim()) return false;
  if (!SIGNAL_TYPES.includes(s.type)) return false;
  return true;
}

function validateReport(r) {
  if (!r) return false;
  if (!r.market_map || !r.avatar || !r.insights || !r.recommendations) return false;
  return true;
}

/** Normalize a raw entity to conform to the Output Contract */
function normalizeEntity(raw) {
  return {
    name:            String(raw.name || '').trim(),
    primary_domain:  raw.primary_domain || raw.domain || null,
    category:        raw.category || 'direct',
    confidence:      Math.min(100, Math.max(0, Number(raw.confidence || 50))),
    priority:        ENTITY_PRIORITIES.includes(raw.priority) ? raw.priority : 'medium',
    ads_count:       Number(raw.ads_count || 0),
    monthly_traffic: raw.monthly_traffic || null,
    ad_platforms:    Array.isArray(raw.ad_platforms) ? raw.ad_platforms : [],
    key_messages:    Array.isArray(raw.key_messages) ? raw.key_messages : [],
    raw_data:        raw.raw_data || {},
  };
}

/** Normalize a raw signal */
function normalizeSignal(raw) {
  return {
    type:       SIGNAL_TYPES.includes(raw.type) ? raw.type : 'pain',
    text:       String(raw.text || '').trim(),
    confidence: Math.min(100, Math.max(0, Number(raw.confidence || 50))),
    frequency:  Number(raw.frequency || 1),
    source:     raw.source || 'claude_researcher',
    segment:    raw.segment || null,
  };
}

module.exports = {
  SIGNAL_TYPES, ENTITY_PRIORITIES, INSIGHT_TYPES, DEPTH_LEVELS, JOB_STATUSES,
  validateEntity, validateSignal, validateReport,
  normalizeEntity, normalizeSignal,
};
