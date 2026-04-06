/**
 * meta-event.js — Server-side Meta Conversions API proxy
 *
 * POST /meta-event
 * Body: { event_name, user_data: { email?, phone?, client_ip?, client_user_agent?, fbc?, fbp? }, custom_data?, event_source_url?, event_id? }
 *
 * Sends the event to Meta Conversions API (server-side leg of hybrid tracking).
 * No auth required — this is a system-level pixel, not per-user.
 * All PII is SHA-256 hashed before transmission per Meta requirements.
 */

'use strict';

const crypto                                    = require('node:crypto');
const { respond, ok, fail }                     = require('./_shared/http');
const { createRequestContext, buildLogPayload } = require('./_shared/observability');
const { writeRequestLog }                       = require('./_shared/supabase');
const { AppError }                              = require('./_shared/errors');
const { parseJsonBody, requireField }           = require('./_shared/request');

const CORS_HEADERS = {
  'access-control-allow-origin':  '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type, x-correlation-id',
  'access-control-max-age':       '86400',
};

function sha256(value) {
  if (!value) return undefined;
  const normalised = String(value).trim().toLowerCase();
  return crypto.createHash('sha256').update(normalised).digest('hex');
}

function buildUserData(raw = {}) {
  const ud = {};

  // Hash PII fields as required by Meta
  if (raw.email)            ud.em  = sha256(raw.email);
  if (raw.phone)            ud.ph  = sha256(raw.phone);
  if (raw.first_name)       ud.fn  = sha256(raw.first_name);
  if (raw.last_name)        ud.ln  = sha256(raw.last_name);

  // Pass-through fields (not hashed)
  if (raw.client_ip)        ud.client_ip_address  = raw.client_ip;
  if (raw.client_user_agent) ud.client_user_agent = raw.client_user_agent;
  if (raw.fbc)              ud.fbc  = raw.fbc;
  if (raw.fbp)              ud.fbp  = raw.fbp;
  if (raw.external_id)      ud.external_id = sha256(raw.external_id);

  return ud;
}

exports.handler = async (event) => {
  const context = createRequestContext(event, 'meta-event');

  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  try {
    if (event.httpMethod !== 'POST') {
      throw new AppError({ code: 'METHOD_NOT_ALLOWED', userMessage: 'Method not allowed', devMessage: 'Unsupported method', status: 405 });
    }

    const pixelId     = process.env.META_PIXEL_ID;
    const accessToken = process.env.FB_ACCESS_TOKEN;
    const apiVersion  = process.env.META_API_VERSION || 'v19.0';

    if (!pixelId || !accessToken) {
      throw new AppError({ code: 'MISCONFIGURED', userMessage: 'שגיאת הגדרה', devMessage: 'META_PIXEL_ID or FB_ACCESS_TOKEN not set', status: 500 });
    }

    const body       = parseJsonBody(event, { fallback: {}, allowEmpty: false, devMessage: 'Missing event data' });
    const eventName  = requireField(body.event_name, 'event_name');
    const userData   = buildUserData(body.user_data || {});
    const customData = body.custom_data || {};
    const eventId    = body.event_id || crypto.randomUUID();
    const sourceUrl  = body.event_source_url || '';

    const payload = {
      data: [{
        event_name:       eventName,
        event_time:       Math.floor(Date.now() / 1000),
        event_id:         eventId,
        event_source_url: sourceUrl,
        action_source:    'website',
        user_data:        userData,
        ...(Object.keys(customData).length ? { custom_data: customData } : {}),
      }],
    };

    const metaUrl = `https://graph.facebook.com/${apiVersion}/${pixelId}/events?access_token=${accessToken}`;

    const metaRes = await fetch(metaUrl, {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body:    JSON.stringify(payload),
    });

    const metaBody = await metaRes.json();

    if (!metaRes.ok) {
      const errMsg = metaBody?.error?.message || `Meta API ${metaRes.status}`;
      throw new AppError({ code: 'META_API_ERROR', userMessage: 'שגיאה בשליחת אירוע', devMessage: errMsg, status: 502 });
    }

    await writeRequestLog(buildLogPayload(context, 'info', 'meta_event_sent', {
      event_name: eventName,
      event_id:   eventId,
      events_fired: metaBody.events_received ?? 0,
    }));

    return respond(200, { ok: true, data: { events_received: metaBody.events_received, event_id: eventId } }, context.requestId, CORS_HEADERS);

  } catch (error) {
    await writeRequestLog(buildLogPayload(context, 'error', error.message || 'meta_event_failed', {
      code: error.code || 'INTERNAL_ERROR',
    })).catch(() => {});
    return fail(error, context.requestId, CORS_HEADERS);
  }
};
