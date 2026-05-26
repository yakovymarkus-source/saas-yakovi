'use strict';
require('./_shared/env');

const { ok, fail, options }     = require('./_shared/http');
const { AppError }               = require('./_shared/errors');
const { requireAuth }           = require('./_shared/auth');
const { parseJsonBody }         = require('./_shared/request');
const { generateAdVisual }      = require('./_shared/visual-generator');

/**
 * POST /generate-ad-visual
 * Body: { platform, type, offer, audience, deal, brand }
 * Returns: { imageUrl, headline, subtext, cta, platform }
 */
exports.handler = async (event) => {
  console.log(`[generate-ad-visual] START: method=${event.httpMethod}`);

  if (event.httpMethod === 'OPTIONS') return options();
  if (event.httpMethod !== 'POST') {
    console.error(`[generate-ad-visual] Invalid method: ${event.httpMethod}`);
    return fail(new AppError({ code: 'METHOD_NOT_ALLOWED', userMessage: 'POST only', status: 405 }));
  }

  let user;
  try {
    user = await requireAuth(event);
    console.log(`[generate-ad-visual] Auth successful: userId=${user.id}`);
  } catch (e) {
    console.error(`[generate-ad-visual] Auth failed: ${e.message}`);
    return fail(e);
  }

  let body;
  try {
    body = parseJsonBody(event);
    console.log(`[generate-ad-visual] Parsed body: ${JSON.stringify(body)}`);
  } catch (e) {
    console.error(`[generate-ad-visual] Parse failed: ${e.message}`);
    return fail(e);
  }

  const { platform = 'facebook', type = 'conversion', offer = '', audience = '', deal = '', brand = '' } = body;

  if (!offer) {
    console.error(`[generate-ad-visual] Missing required field: offer`);
    return fail(new AppError({ code: 'BAD_REQUEST', userMessage: 'offer is required', status: 400 }));
  }

  console.log(`[generate-ad-visual] Calling generateAdVisual: platform=${platform}, type=${type}, offer="${offer.slice(0,30)}..."`);
  const result = await generateAdVisual({ platform, type, offer, audience, deal, brand });

  if (result.error) {
    console.error(`[generate-ad-visual] generateAdVisual returned error: ${result.error}`);
    return fail(new AppError({ code: 'AI_ERROR', userMessage: result.error, status: 500 }));
  }

  console.log(`[generate-ad-visual] SUCCESS: imageUrl=${result.imageUrl.slice(0,50)}..., headline="${result.headline}"`);
  return ok(result);
};
