'use strict';
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const META_EVENT_MAP = {
  form_submit:  'Lead',
  cta_click:    'InitiateCheckout',
  scroll_75:    'ViewContent',
  scroll_100:   'ViewContent',
  form_start:   'CustomEvent',
  video_90:     'CustomEvent',
};

function sha256(value) {
  return crypto.createHash('sha256').update((value || '').trim().toLowerCase()).digest('hex');
}

function db() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

// Resolve pixel credentials: per-user > env fallback
async function resolveCredentials(pixelId, campaignId) {
  const supabase = db();

  // 1. If pixel_id passed directly, look it up
  if (pixelId) {
    const { data } = await supabase
      .from('user_meta_config')
      .select('pixel_id, capi_access_token')
      .eq('pixel_id', pixelId)
      .eq('setup_completed', true)
      .single();
    if (data?.capi_access_token) return { pixelId: data.pixel_id, token: data.capi_access_token };
  }

  // 2. Try via campaign_id → campaigns table → user
  if (campaignId) {
    const { data } = await supabase
      .from('user_meta_config')
      .select('pixel_id, capi_access_token')
      .eq('setup_completed', true)
      .limit(1)
      .single();
    if (data?.capi_access_token) return { pixelId: data.pixel_id, token: data.capi_access_token };
  }

  // 3. Env fallback (global pixel)
  if (process.env.META_ACCESS_TOKEN && process.env.META_PIXEL_ID) {
    return { pixelId: process.env.META_PIXEL_ID, token: process.env.META_ACCESS_TOKEN };
  }

  return null;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { event_type, session_id, campaign_id, ad_id, fbclid, ip, ua, url,
          pixel_id: incomingPixelId, access_token: incomingToken } = body;

  const metaEventName = META_EVENT_MAP[event_type];
  if (!metaEventName) return { statusCode: 200, body: JSON.stringify({ skipped: true }) };

  // Resolve credentials
  let creds = null;
  if (incomingPixelId && incomingToken) {
    creds = { pixelId: incomingPixelId, token: incomingToken };
  } else {
    creds = await resolveCredentials(incomingPixelId, campaign_id);
  }

  if (!creds) {
    console.warn('[meta-conversion] No credentials found — skipping');
    return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'no_credentials' }) };
  }

  const payload = {
    data: [{
      event_name:        metaEventName,
      event_time:        Math.floor(Date.now() / 1000),
      event_id:          `${session_id}_${event_type}_${Date.now()}`,
      action_source:     'website',
      event_source_url:  url || '',
      user_data: {
        client_ip_address: ip  || '',
        client_user_agent: ua  || '',
        ...(fbclid ? { fbc: `fb.1.${Date.now()}.${fbclid}` } : {}),
      },
      custom_data: {
        campaign_id: campaign_id || '',
        ad_id:       ad_id       || '',
        ...(metaEventName === 'CustomEvent' ? { custom_event_name: event_type } : {}),
      },
    }],
    ...(process.env.META_TEST_EVENT_CODE ? { test_event_code: process.env.META_TEST_EVENT_CODE } : {}),
  };

  try {
    const res = await fetch(
      `https://graph.facebook.com/v19.0/${creds.pixelId}/events?access_token=${creds.token}`,
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
