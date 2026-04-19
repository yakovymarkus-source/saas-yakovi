/**
 * business-profile.js — Business profile read/update endpoint
 *
 * GET  /business-profile       — load current profile + completion score
 * POST /business-profile       — upsert profile fields (partial update OK)
 *
 * Body (POST): { fields: { offer?, price_amount?, target_audience?, ... } }
 *
 * Returns:
 *   { profile, completion: { pct, missingRequired, missingEnrichment }, nextQuestion }
 */

'use strict';

const { ok, fail, options }                     = require('./_shared/http');
const { createRequestContext, buildLogPayload } = require('./_shared/observability');
const { writeRequestLog }                       = require('./_shared/supabase');
const { requireAuth }                           = require('./_shared/auth');
const { AppError }                              = require('./_shared/errors');
const { parseJsonBody }                         = require('./_shared/request');
const {
  loadBusinessProfile,
  upsertBusinessProfile,
  scoreCompletion,
  buildNextProfileQuestion,
} = require('./_shared/business-profile');
const { advanceOnboarding, buildUnlockedScreens } = require('./_shared/product-context');

// ── Allowed fields whitelist (mirrors business-profile.js ALLOWED set) ────────
const UPDATABLE_FIELDS = new Set([
  'business_name', 'category', 'offer', 'price_amount', 'price_currency',
  'pricing_model', 'target_audience', 'problem_solved', 'desired_outcome',
  'unique_mechanism', 'main_promise', 'tone_keywords', 'primary_goal',
  'monthly_budget', 'test_budget',
]);

function validateFields(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new AppError({ code: 'BAD_REQUEST', userMessage: 'fields חייב להיות אובייקט', devMessage: 'fields must be a plain object', status: 400 });
  }

  const clean = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!UPDATABLE_FIELDS.has(k)) continue;  // silently drop unknown keys

    // Type coercion for numeric fields
    if (['price_amount', 'monthly_budget', 'test_budget'].includes(k)) {
      const num = Number(v);
      if (v !== null && v !== '' && (isNaN(num) || num < 0)) {
        throw new AppError({ code: 'BAD_REQUEST', userMessage: `${k} חייב להיות מספר חיובי`, devMessage: `${k} must be a non-negative number`, status: 400 });
      }
      clean[k] = v === null || v === '' ? null : num;
      continue;
    }

    // String fields
    if (typeof v === 'string') {
      clean[k] = v.trim() || null;
    } else if (Array.isArray(v)) {
      clean[k] = v;  // tone_keywords
    } else if (v === null) {
      clean[k] = null;
    }
  }

  if (Object.keys(clean).length === 0) {
    throw new AppError({ code: 'BAD_REQUEST', userMessage: 'לא הועברו שדות לעדכון', devMessage: 'No valid fields to update', status: 400 });
  }

  return clean;
}

function buildResponse(profile) {
  const { pct, missingRequired, missingEnrichment } = scoreCompletion(profile);
  return {
    // Spread profile fields so the frontend can read them directly
    ...(profile || {}),
    // Nested completion object (used by chat / internal logic)
    completion:       { pct, missingRequired, missingEnrichment },
    // Flat aliases — frontend reads bp.completion_score or bp.completionScore
    completion_score: pct,
    completionScore:  pct,
    missingRequired,
    missingEnrichment,
    nextQuestion:     buildNextProfileQuestion(missingRequired, missingEnrichment),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options();
  const ctx = createRequestContext(event, 'business-profile');

  try {
    const user = await requireAuth(event, ctx.functionName, ctx);

    // ── GET ──────────────────────────────────────────────────────────────────
    if (event.httpMethod === 'GET') {
      const profile = await loadBusinessProfile(user.id);
      await writeRequestLog(buildLogPayload(ctx, 'info', 'business_profile_read', { user_id: user.id }));
      return ok(buildResponse(profile), ctx.requestId);
    }

    // ── POST (upsert) ────────────────────────────────────────────────────────
    if (event.httpMethod === 'POST') {
      const body   = parseJsonBody(event, { fallback: {}, allowEmpty: false, devMessage: 'Missing body' });
      const fields = validateFields(body.fields ?? body);   // accept {fields:{...}} or flat {...}

      const updated = await upsertBusinessProfile(user.id, fields);
      if (!updated) {
        throw new AppError({ code: 'DB_WRITE_FAILED', userMessage: 'עדכון הפרופיל נכשל', devMessage: 'upsertBusinessProfile returned null', status: 500 });
      }

      await writeRequestLog(buildLogPayload(ctx, 'info', 'business_profile_updated', {
        user_id:       user.id,
        fields_updated: Object.keys(fields),
        completed:      updated.completed,
      }));

      // Advance onboarding state machine (fire-and-forget)
      const { getAdminClient } = require('./_shared/supabase');
      const sb = getAdminClient();
      advanceOnboarding(user.id, sb, 'profile_started').catch(() => {});
      if (updated.completed) {
        advanceOnboarding(user.id, sb, 'profile_complete').catch(() => {});
      }

      const { deriveStage } = require('./_shared/product-context');
      const resp = buildResponse(updated);
      resp.stage = updated.completed ? 'has_profile' : 'profile_started';

      return ok(resp, ctx.requestId);
    }

    throw new AppError({ code: 'METHOD_NOT_ALLOWED', userMessage: 'Method not allowed', devMessage: 'Use GET or POST', status: 405 });

  } catch (error) {
    await writeRequestLog(buildLogPayload(ctx, 'error', error.message || 'business_profile_failed', {
      code: error.code || 'INTERNAL_ERROR',
    })).catch(() => {});
    return fail(error, ctx.requestId);
  }
};
