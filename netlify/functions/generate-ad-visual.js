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
  if (event.httpMethod === 'OPTIONS') return options();
  if (event.httpMethod !== 'POST') return fail(new AppError({ code: 'METHOD_NOT_ALLOWED', userMessage: 'POST only', status: 405 }));

  let user;
  try { user = await requireAuth(event); } catch (e) { return fail(e); }

  let body;
  try { body = parseJsonBody(event); } catch (e) { return fail(e); }

  const { platform = 'facebook', type = 'conversion', offer = '', audience = '', deal = '', brand = '' } = body;
  if (!offer) return fail(new AppError({ code: 'BAD_REQUEST', userMessage: 'offer is required', status: 400 }));

  const result = await generateAdVisual({ platform, type, offer, audience, deal, brand });

  if (result.error) return fail(new AppError({ code: 'AI_ERROR', userMessage: result.error, status: 500 }));

  return ok(result);
};
