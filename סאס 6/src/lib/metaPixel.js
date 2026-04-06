/**
 * metaPixel.js — Hybrid Meta tracking (Browser Pixel + Server-side Conversions API)
 *
 * Usage:
 *   import { initPixel, trackEvent } from './metaPixel.js';
 *   // or load as <script type="module"> and call window.MetaPixel.*
 *
 * initPixel()         — call once on page load
 * trackEvent(name, data) — fires both fbq (browser) and /api/meta-event (server) in parallel
 *
 * Deduplication: both legs share the same eventId so Meta deduplicates them.
 */

'use strict';

// ── Helpers ────────────────────────────────────────────────────────────────────

function getPixelId() {
  return window.__META_PIXEL_ID__ || '';
}

function randomEventId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function getCookie(name) {
  const match = document.cookie.match(new RegExp('(?:^|;)\\s*' + name + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : undefined;
}

// ── Pixel init ─────────────────────────────────────────────────────────────────

/**
 * Injects the Meta Pixel snippet and fires PageView.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
function initPixel() {
  const pixelId = getPixelId();
  if (!pixelId) {
    console.warn('[MetaPixel] META_PIXEL_ID not set — pixel not initialised');
    return;
  }
  if (window._metaPixelInitialised) return;
  window._metaPixelInitialised = true;

  /* eslint-disable */
  !function(f,b,e,v,n,t,s){
    if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};
    if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
    n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];
    s.parentNode.insertBefore(t,s)
  }(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
  /* eslint-enable */

  window.fbq('init', pixelId);
  window.fbq('track', 'PageView');
}

// ── Server-side leg ────────────────────────────────────────────────────────────

async function sendToServer(eventName, data, eventId) {
  try {
    const payload = {
      event_name:       eventName,
      event_id:         eventId,
      event_source_url: window.location.href,
      user_data: {
        fbc:               getCookie('_fbc'),
        fbp:               getCookie('_fbp'),
        client_user_agent: navigator.userAgent,
        ...(data.user_data || {}),
      },
      custom_data: data.custom_data || {},
    };

    await fetch('/api/meta-event', {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body:    JSON.stringify(payload),
    });
  } catch (err) {
    // Non-blocking — never let server leg break the page
    console.warn('[MetaPixel] Server-side send failed:', err);
  }
}

// ── Browser leg ───────────────────────────────────────────────────────────────

function sendToBrowser(eventName, data, eventId) {
  if (typeof window.fbq !== 'function') return;

  const fbqData    = data.fbq_data    || data.custom_data || {};
  const isStandard = data.is_standard !== false; // default: standard event

  if (isStandard) {
    window.fbq('track', eventName, fbqData, { eventID: eventId });
  } else {
    window.fbq('trackCustom', eventName, fbqData, { eventID: eventId });
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Track an event on both the browser pixel and the server-side CAPI.
 *
 * @param {string} eventName  — Standard Meta event name (e.g. 'Lead', 'Purchase') or custom
 * @param {object} data       — Optional payload:
 *   {
 *     user_data:   { email?, phone?, external_id? },  // hashed server-side
 *     custom_data: { value?, currency?, content_name?, ... },
 *     fbq_data:    { ... },  // overrides custom_data for the browser pixel only
 *     is_standard: true,     // false → trackCustom instead of track
 *   }
 */
function trackEvent(eventName, data = {}) {
  const eventId = randomEventId();

  // Fire both legs in parallel — neither waits for the other
  sendToBrowser(eventName, data, eventId);
  sendToServer(eventName, data, eventId);
}

// ── Export ─────────────────────────────────────────────────────────────────────

// Support both ES module import and direct <script> inclusion
const MetaPixel = { initPixel, trackEvent };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = MetaPixel;
} else if (typeof window !== 'undefined') {
  window.MetaPixel = MetaPixel;
}

export { initPixel, trackEvent };
