'use strict';
require('./_shared/env');

const { ok, fail, options }     = require('./_shared/http');
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
  if (event.httpMethod !== 'POST') return fail('METHOD_NOT_ALLOWED', 'POST only', 405);

  let user;
  try { user = await requireAuth(event); } catch (e) { return fail('UNAUTHORIZED', e.message, 401); }

  let body;
  try { body = parseJsonBody(event); } catch { return fail('BAD_REQUEST', 'invalid JSON', 400); }

  const { platform = 'facebook', type = 'conversion', offer = '', audience = '', deal = '', brand = '' } = body;
  if (!offer) return fail('BAD_REQUEST', 'offer is required', 400);

  const result = await generateAdVisual({ platform, type, offer, audience, deal, brand });

  if (result.error) return fail('AI_ERROR', result.error, 500);

  return ok(result);
};
