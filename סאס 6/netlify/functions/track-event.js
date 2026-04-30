'use strict';
const { createClient } = require('@supabase/supabase-js');

// High-intent events worth forwarding to Meta CAPI
const CAPI_EVENTS = new Set(['form_submit', 'cta_click', 'scroll_75', 'scroll_100']);

function db() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const {
    session_id, landing_page_id, campaign_id, ad_id, event_type,
    event_data, scroll_depth, time_on_page, device_type, url,
    utm_source, utm_medium, utm_campaign, utm_content, utm_term,
    fbclid, gclid, referrer, label, src, message, source, line,
    field, form_id, section, element, text_preview, tag
  } = payload;

  if (!session_id || !event_type) {
    return { statusCode: 400, body: JSON.stringify({ error: 'session_id and event_type required' }) };
  }

  const ip = (event.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ua = event.headers['user-agent'] || '';

  const supabase = db();

  // Upsert session on page_view
  if (event_type === 'page_view') {
    await supabase.from('landing_page_sessions').upsert({
      session_id, landing_page_id, campaign_id, ad_id,
      utm_source, utm_medium, utm_campaign, utm_content, utm_term,
      fbclid, gclid, referrer, url,
      device_type, user_agent: ua,
      ip_hash: ip ? Buffer.from(ip).toString('base64') : null,
    }, { onConflict: 'session_id', ignoreDuplicates: true });
  }

  // Save raw event
  const extraData = { label, src, message, source, line, field, form_id, section, element, text_preview, tag };
  Object.keys(extraData).forEach(k => extraData[k] === undefined && delete extraData[k]);

  await supabase.from('raw_events').insert({
    session_id, landing_page_id, campaign_id, ad_id,
    event_type,
    event_data: Object.keys(extraData).length ? extraData : (event_data || {}),
    scroll_depth: scroll_depth || null,
    time_on_page: time_on_page || null,
    device_type, url,
  });

  // Fire CAPI for high-intent events (non-blocking)
  if (CAPI_EVENTS.has(event_type) && process.env.META_ACCESS_TOKEN && process.env.META_PIXEL_ID) {
    const baseUrl = process.env.URL || 'http://localhost:8888';
    fetch(`${baseUrl}/.netlify/functions/meta-conversion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_type, session_id, campaign_id, ad_id, fbclid, ip, ua, url }),
    }).catch(e => console.error('[track-event] CAPI fire failed:', e.message));
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};
