'use strict';

/**
 * asset-feedback.js — Asset Feedback Endpoint
 *
 * POST /.netlify/functions/asset-feedback
 *
 * Records user feedback on a generated asset and updates userIntelligence
 * so future generations learn from it.
 *
 * Body:
 *   asset_id   {string}  — UUID of the generated asset (required)
 *   event      {string}  — 'approved' | 'rejected' | 'edited' | 'viewed'
 *   reason     {string?} — rejection reason (optional)
 *   edit_note  {string?} — free-text description of desired change (for 'edited')
 */

const { ok, fail, options }    = require('./_shared/http');
const { createRequestContext } = require('./_shared/observability');
const { requireAuth }          = require('./_shared/auth');
const { parseJsonBody }        = require('./_shared/request');
const { AppError }             = require('./_shared/errors');
const { learnFromFeedback }    = require('./_shared/feedback-loop');

const VALID_EVENTS  = new Set(['approved', 'rejected', 'edited', 'viewed']);
const VALID_REASONS = new Set(['too_generic', 'wrong_style', 'wrong_cta', 'too_long', 'too_short', 'other', 'unspecified']);

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options();
  const ctx = createRequestContext(event, 'asset-feedback');

  try {
    if (event.httpMethod !== 'POST') {
      throw new AppError({ code: 'METHOD_NOT_ALLOWED', userMessage: 'Use POST', status: 405 });
    }

    const user = await requireAuth(event, 'asset-feedback', ctx);
    const body = parseJsonBody(event, { allowEmpty: false, devMessage: 'Missing body' });

    const { asset_id, event: feedbackEvent, reason, edit_note } = body;

    if (!asset_id) {
      throw new AppError({ code: 'BAD_REQUEST', userMessage: 'חסר asset_id', status: 400 });
    }
    if (!feedbackEvent || !VALID_EVENTS.has(feedbackEvent)) {
      throw new AppError({
        code: 'BAD_REQUEST',
        userMessage: `event לא תקין. מותר: ${[...VALID_EVENTS].join(', ')}`,
        status: 400,
      });
    }

    const safeReason   = reason    && VALID_REASONS.has(reason) ? reason : (reason ? 'other' : null);
    const safeEditNote = edit_note ? String(edit_note).slice(0, 300) : null;

    // Fire-and-forget — learn does not need to complete before we respond
    learnFromFeedback(user.id, asset_id, feedbackEvent, {
      reason:   safeReason,
      editNote: safeEditNote,
    }).catch(() => {});

    return ok({ received: true, event: feedbackEvent }, ctx.requestId);

  } catch (err) {
    return fail(err, ctx.requestId);
  }
};
