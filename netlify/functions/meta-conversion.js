'use strict';
const crypto = require('crypto');

// Map internal event names → Meta standard events
const META_EVENT_MAP = {
  form_submit:  'Lead',
  cta_click:    'InitiateCheckout',
  scroll_75:    'ViewContent',
  scroll_100:   'ViewContent',
};

function sha256(value) {
  return crypto.createHash('sha256').update((value || '').trim().toLowerCase()).digest('hex');
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const token   = process.env.META_ACCESS_TOKEN;
  const pixelId = process.env.META_PIXEL_ID;
  if (!token || !pixelId) {
    return { statusCode: 503, body: JSON.stringify({ error: 'Meta credentials not configured' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { event_type, session_id, campaign_id, ad_id, fbclid, ip, ua, url } = body;
  const metaEventName = META_EVENT_MAP[event_type];
  if (!metaEventName) return { statusCode: 200, body: JSON.stringify({ skipped: true }) };

  const payload = {
    data: [{
      event_name:  metaEventName,
      event_time:  Math.floor(Date.now() / 1000),
      event_id:    session_id + '_' + event_type + '_' + Date.now(),
      action_source: 'website',
      event_source_url: url || '',
      user_data: {
        client_ip_address: ip || '',
        client_user_agent: ua || '',
        fbc: fbclid ? 'fb.1.' + Date.now() + '.' + fbclid : undefined,
      },
      custom_data: {
        campaign_id: campaign_id || '',
        ad_id:       ad_id || '',
      },
    }],
    test_event_code: process.env.META_TEST_EVENT_CODE || undefined,
  };

  // Remove undefined fields
  if (!payload.data[0].user_data.fbc) delete payload.data[0].user_data.fbc;
  if (!payload.test_event_code) delete payload.test_event_code;

  try {
    const res = await fetch(
      `https://graph.facebook.com/v19.0/${pixelId}/events?access_token=${token}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
    );
    const result = await res.json();
    if (!res.ok) {
      console.error('[meta-conversion] API error:', JSON.stringify(result));
      return { statusCode: 502, body: JSON.stringify({ error: result }) };
    }
    return { statusCode: 200, body: JSON.stringify({ ok: true, events_received: result.events_received }) };
  } catch (err) {
    console.error('[meta-conversion] fetch error:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
