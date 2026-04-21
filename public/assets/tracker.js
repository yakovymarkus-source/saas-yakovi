(function () {
  'use strict';

  // ── Config ────────────────────────────────────────────────────────────────
  var ENDPOINT = '/.netlify/functions/track-event';
  var SESSION_KEY = 'fc_session_id';
  var UTM_KEY = 'fc_utm';

  // ── Session ───────────────────────────────────────────────────────────────
  function getSessionId() {
    var id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = 'ses_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  }

  // ── UTM / URL params ──────────────────────────────────────────────────────
  function parseUTM() {
    var stored = localStorage.getItem(UTM_KEY);
    var params = {};
    try {
      var q = new URLSearchParams(window.location.search);
      ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','fbclid','gclid','ad_id'].forEach(function(k) {
        if (q.get(k)) params[k] = q.get(k);
      });
      if (Object.keys(params).length) {
        localStorage.setItem(UTM_KEY, JSON.stringify(params));
        return params;
      }
    } catch(e) {}
    try { return stored ? JSON.parse(stored) : {}; } catch(e) { return {}; }
  }

  // ── Device ────────────────────────────────────────────────────────────────
  function getDevice() {
    return /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? 'mobile' : 'desktop';
  }

  // ── Campaign ID from script tag ───────────────────────────────────────────
  function getCampaignId() {
    var s = document.currentScript || document.querySelector('script[data-campaign-id]');
    return s ? (s.getAttribute('data-campaign-id') || '') : '';
  }

  // ── Send ──────────────────────────────────────────────────────────────────
  var sessionId = getSessionId();
  var utm = parseUTM();
  var campaignId = utm.campaign_id || getCampaignId() || '';
  var landingPageId = window.location.pathname;

  function send(eventType, extra) {
    var payload = JSON.stringify(Object.assign({
      session_id:      sessionId,
      landing_page_id: landingPageId,
      campaign_id:     campaignId,
      ad_id:           utm.ad_id || '',
      event_type:      eventType,
      device_type:     getDevice(),
      url:             window.location.href,
      time_on_page:    Math.round((Date.now() - pageStart) / 1000),
      utm_source:      utm.utm_source || '',
      utm_medium:      utm.utm_medium || '',
      utm_campaign:    utm.utm_campaign || '',
      utm_content:     utm.utm_content || '',
      utm_term:        utm.utm_term || '',
      fbclid:          utm.fbclid || '',
      gclid:           utm.gclid || ''
    }, extra || {}));

    if (navigator.sendBeacon) {
      navigator.sendBeacon(ENDPOINT, new Blob([payload], { type: 'application/json' }));
    } else {
      fetch(ENDPOINT, { method: 'POST', body: payload, headers: { 'Content-Type': 'application/json' }, keepalive: true }).catch(function(){});
    }
  }

  var pageStart = Date.now();

  // ── 1. Page View ──────────────────────────────────────────────────────────
  send('page_view', {
    referrer:    document.referrer,
    device_type: getDevice()
  });

  // ── 2. Scroll milestones (25/50/75/100) ──────────────────────────────────
  var scrollFired = {};
  var scrollThrottle = null;
  window.addEventListener('scroll', function () {
    if (scrollThrottle) return;
    scrollThrottle = setTimeout(function () {
      scrollThrottle = null;
      var pct = Math.round((window.scrollY + window.innerHeight) / document.body.scrollHeight * 100);
      [25, 50, 75, 100].forEach(function (m) {
        if (pct >= m && !scrollFired[m]) {
          scrollFired[m] = true;
          send('scroll_' + m, { scroll_depth: m });
        }
      });
    }, 200);
  }, { passive: true });

  // ── 3. Time on page (10s / 30s / 60s) ────────────────────────────────────
  [10, 30, 60].forEach(function (sec) {
    setTimeout(function () { send('time_' + sec + 's', { time_on_page: sec }); }, sec * 1000);
  });

  // ── 4. Dwell on section (IntersectionObserver, 5s) ───────────────────────
  if (window.IntersectionObserver) {
    var dwellTimers = {};
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var el = entry.target;
        var key = el.getAttribute('data-track-id') || el.id || el.className.split(' ')[0];
        if (entry.isIntersecting) {
          dwellTimers[key] = setTimeout(function () {
            send('dwell_on_section', { section: key });
          }, 5000);
        } else {
          clearTimeout(dwellTimers[key]);
        }
      });
    }, { threshold: 0.5 });
    document.querySelectorAll('[data-track="true"]').forEach(function (el) {
      observer.observe(el);
    });
  }

  // ── 5. Element in-view (2s on pricing/testimonials) ──────────────────────
  if (window.IntersectionObserver) {
    var inviewTimers = {};
    var inviewObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var el = entry.target;
        var key = el.getAttribute('data-inview-id') || el.id || 'element';
        if (entry.isIntersecting) {
          inviewTimers[key] = setTimeout(function () {
            send('element_in_view', { element: key });
          }, 2000);
        } else {
          clearTimeout(inviewTimers[key]);
        }
      });
    }, { threshold: 0.4 });
    document.querySelectorAll('[data-inview="true"]').forEach(function (el) {
      inviewObserver.observe(el);
    });
  }

  // ── 6. CTA click ─────────────────────────────────────────────────────────
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-cta],[href*="wa.me"],[href*="whatsapp"],button,a');
    if (!el) return;
    var label = el.getAttribute('data-cta') || el.innerText.trim().slice(0, 50) || el.href || '';
    send('cta_click', { label: label, tag: el.tagName.toLowerCase() });
  });

  // ── 7. Form start (first keydown in form field) ───────────────────────────
  var formStartFired = false;
  document.addEventListener('focusin', function (e) {
    if (formStartFired) return;
    if (e.target.matches('input,textarea,select')) {
      formStartFired = true;
      send('form_start', { field: e.target.name || e.target.type || 'unknown' });
    }
  });

  // ── 8. Form submit ────────────────────────────────────────────────────────
  document.addEventListener('submit', function (e) {
    var form = e.target;
    send('form_submit', { form_id: form.id || form.action || 'unknown' });
  });

  // ── 9. Video events (play / 50% / 90%) ───────────────────────────────────
  document.addEventListener('play', function (e) {
    if (e.target.tagName === 'VIDEO') send('video_play', { src: e.target.currentSrc });
  }, true);
  document.addEventListener('timeupdate', function (e) {
    var v = e.target;
    if (v.tagName !== 'VIDEO' || !v.duration) return;
    var pct = v.currentTime / v.duration * 100;
    v._fc = v._fc || {};
    [50, 90].forEach(function (m) {
      if (pct >= m && !v._fc[m]) {
        v._fc[m] = true;
        send('video_' + m, { src: v.currentSrc });
      }
    });
  }, true);

  // ── 10. Exit intent (mouse toward top of window) ──────────────────────────
  var exitFired = false;
  document.addEventListener('mouseleave', function (e) {
    if (exitFired || e.clientY > 10) return;
    exitFired = true;
    send('exit_intent', { scroll_depth: Math.round((window.scrollY + window.innerHeight) / document.body.scrollHeight * 100) });
  });

  // ── 11. Rage clicks (3+ clicks on same element within 500ms) ─────────────
  var clickLog = [];
  document.addEventListener('click', function (e) {
    var now = Date.now();
    clickLog = clickLog.filter(function (c) { return now - c.t < 500; });
    clickLog.push({ t: now, el: e.target });
    var sameEl = clickLog.filter(function (c) { return c.el === e.target; });
    if (sameEl.length >= 3) {
      clickLog = [];
      var tag = e.target.tagName.toLowerCase();
      var label = e.target.innerText ? e.target.innerText.trim().slice(0, 50) : (e.target.src || e.target.href || '');
      send('rage_click', { tag: tag, label: label });
    }
  });

  // ── 12. Text copy / selection ─────────────────────────────────────────────
  var copyDebounce = null;
  document.addEventListener('copy', function () {
    clearTimeout(copyDebounce);
    copyDebounce = setTimeout(function () {
      var sel = window.getSelection ? window.getSelection().toString().slice(0, 100) : '';
      send('text_copy', { text_preview: sel });
    }, 100);
  });

  // ── 13. Back navigation ───────────────────────────────────────────────────
  window.addEventListener('popstate', function () {
    send('back_navigation', { time_on_page: Math.round((Date.now() - pageStart) / 1000) });
  });

  // ── 14. JS errors ─────────────────────────────────────────────────────────
  window.addEventListener('error', function (e) {
    send('js_error', {
      message: e.message ? e.message.slice(0, 200) : 'unknown',
      source:  e.filename ? e.filename.slice(0, 200) : '',
      line:    e.lineno || 0
    });
  });

  // ── 15. Broken images ─────────────────────────────────────────────────────
  document.addEventListener('error', function (e) {
    if (e.target.tagName === 'IMG') {
      send('broken_image', { src: (e.target.src || '').slice(0, 200) });
    }
  }, true);

})();
