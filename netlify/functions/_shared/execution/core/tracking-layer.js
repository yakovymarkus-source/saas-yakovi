'use strict';
/**
 * execution/core/tracking-layer.js
 * Tracking & Analytics Layer.
 * Generates Event Map + pixel placement strategy per landing page.
 * Supports: Meta Pixel, Google Analytics 4, Google Ads, Custom.
 */

const PIXEL_EVENTS = {
  meta: {
    PageView:             { trigger: 'page_load',    placement: 'head',   type: 'standard' },
    ViewContent:          { trigger: 'scroll_50',    placement: 'body',   type: 'standard' },
    Lead:                 { trigger: 'form_submit',  placement: 'body',   type: 'standard' },
    CompleteRegistration: { trigger: 'thank_you',    placement: 'body',   type: 'standard' },
    Purchase:             { trigger: 'purchase',     placement: 'body',   type: 'standard' },
    InitiateCheckout:     { trigger: 'cta_click',    placement: 'body',   type: 'standard' },
    AddToCart:            { trigger: 'offer_view',   placement: 'body',   type: 'standard' },
  },
  ga4: {
    page_view:     { trigger: 'page_load',    placement: 'head', type: 'automatic' },
    session_start: { trigger: 'page_load',    placement: 'head', type: 'automatic' },
    scroll:        { trigger: 'scroll_90',    placement: 'body', type: 'enhanced' },
    view_item:     { trigger: 'scroll_50',    placement: 'body', type: 'ecommerce' },
    generate_lead: { trigger: 'form_submit',  placement: 'body', type: 'conversion' },
    purchase:      { trigger: 'purchase',     placement: 'body', type: 'conversion' },
    begin_checkout: { trigger: 'cta_click',   placement: 'body', type: 'ecommerce' },
  },
  google_ads: {
    conversion:   { trigger: 'form_submit',  placement: 'body', type: 'conversion' },
    remarketing:  { trigger: 'page_load',    placement: 'head', type: 'remarketing' },
  },
  custom: {
    funnel_step:     { trigger: 'scroll_percent', placement: 'body', type: 'custom' },
    time_on_page:    { trigger: 'time_30s',       placement: 'body', type: 'custom' },
    video_play:      { trigger: 'video_click',    placement: 'body', type: 'custom' },
    cta_hover:       { trigger: 'hover_cta',      placement: 'body', type: 'custom' },
  },
};

const FUNNEL_STAGE_EVENTS = {
  top:    ['PageView', 'ViewContent', 'page_view'],
  middle: ['ViewContent', 'scroll', 'view_item', 'time_on_page', 'funnel_step'],
  bottom: ['Lead', 'generate_lead', 'InitiateCheckout', 'begin_checkout', 'conversion', 'Purchase', 'purchase'],
};

function buildTrackingLayer({ brief, landingPageSections, funnelStage, pixels }) {
  const requestedPixels = pixels || _inferPixels(brief.platform);
  const cgoal           = brief.funnel?.conversion_method || 'lead';
  const stage           = funnelStage || 'bottom';

  // ── Event Map ─────────────────────────────────────────────────────────────
  const eventMap = _buildEventMap({ requestedPixels, stage, cgoal, landingPageSections });

  // ── Pixel Strategy ────────────────────────────────────────────────────────
  const pixelStrategy = _buildPixelStrategy({ requestedPixels, cgoal, brief });

  // ── Placement Instructions ────────────────────────────────────────────────
  const placement = _buildPlacement({ requestedPixels, eventMap });

  // ── Code Snippets (structure only — no actual keys) ───────────────────────
  const codeSnippets = _buildCodeSnippets({ requestedPixels, eventMap });

  // ── Section-level trigger mapping ─────────────────────────────────────────
  const sectionTriggers = _mapSectionsToTriggers(landingPageSections || []);

  return {
    pixels:          requestedPixels,
    eventMap,
    pixelStrategy,
    placement,
    codeSnippets,
    sectionTriggers,
    // Flat output for LP generation
    headCode:        placement.head,
    bodyCode:        placement.body,
    primaryConversion: _getPrimaryConversionEvent(requestedPixels, cgoal),
  };
}

function _inferPixels(platform) {
  const map = {
    meta:      ['meta', 'ga4'],
    instagram: ['meta', 'ga4'],
    tiktok:    ['tiktok', 'ga4'],
    google:    ['google_ads', 'ga4'],
    youtube:   ['google_ads', 'ga4'],
    linkedin:  ['linkedin', 'ga4'],
    email:     ['ga4'],
  };
  return map[platform] || ['meta', 'ga4'];
}

function _buildEventMap({ requestedPixels, stage, cgoal, landingPageSections }) {
  const events = [];
  const relevantStageEvents = FUNNEL_STAGE_EVENTS[stage] || FUNNEL_STAGE_EVENTS.bottom;

  for (const pixelName of requestedPixels) {
    const pixelEvents = PIXEL_EVENTS[pixelName] || {};
    for (const [eventName, config] of Object.entries(pixelEvents)) {
      // Only include events relevant to this funnel stage
      const isRelevant = relevantStageEvents.some(e => e.toLowerCase() === eventName.toLowerCase());
      const isConversion = _isConversionEvent(eventName, cgoal);
      if (isRelevant || isConversion) {
        events.push({
          pixel:       pixelName,
          event:       eventName,
          trigger:     config.trigger,
          placement:   config.placement,
          type:        config.type,
          priority:    isConversion ? 'critical' : 'standard',
          section:     _mapTriggerToSection(config.trigger, landingPageSections),
        });
      }
    }
  }

  return events;
}

function _buildPixelStrategy({ requestedPixels, cgoal, brief }) {
  const primary   = _getPrimaryConversionEvent(requestedPixels, cgoal);
  const secondary = requestedPixels.includes('meta') ? 'ViewContent' :
                    requestedPixels.includes('ga4')   ? 'scroll'      : null;

  return {
    primaryConversion:   primary,
    secondaryEngagement: secondary,
    remarketingEnabled:  requestedPixels.includes('google_ads') || requestedPixels.includes('meta'),
    attributionWindow:   _getAttributionWindow(brief.productType),
    goal:                cgoal,
  };
}

function _buildPlacement({ requestedPixels, eventMap }) {
  const head = [];
  const body = [];

  for (const pixelName of requestedPixels) {
    head.push({
      pixel:    pixelName,
      type:     'base_code',
      note:     `${pixelName} base pixel — place in <head>`,
      position: 'before_</head>',
    });
  }

  for (const event of eventMap) {
    if (event.placement === 'body') {
      body.push({
        pixel:   event.pixel,
        event:   event.event,
        trigger: event.trigger,
        section: event.section || 'body',
        note:    `Fire ${event.event} on ${event.trigger} — place near ${event.section || 'relevant section'}`,
      });
    }
  }

  return { head, body };
}

function _buildCodeSnippets({ requestedPixels, eventMap }) {
  const snippets = {};

  for (const pixelName of requestedPixels) {
    snippets[pixelName] = {
      base: `<!-- ${pixelName.toUpperCase()} BASE CODE — add your pixel ID -->`,
      events: eventMap
        .filter(e => e.pixel === pixelName)
        .map(e => ({
          event:   e.event,
          trigger: e.trigger,
          snippet: _eventSnippet(pixelName, e.event),
        })),
    };
  }

  return snippets;
}

function _mapSectionsToTriggers(sections) {
  const map = {};
  const SECTION_TRIGGERS = {
    hero:          ['PageView', 'page_view', 'ViewContent'],
    pain_block:    ['scroll', 'funnel_step'],
    solution:      ['ViewContent', 'view_item'],
    proof:         ['scroll', 'time_on_page'],
    offer:         ['InitiateCheckout', 'begin_checkout'],
    cta:           ['Lead', 'generate_lead', 'conversion'],
    urgency_block: ['cta_hover'],
    faq:           ['time_on_page'],
  };

  for (const section of sections) {
    map[section] = SECTION_TRIGGERS[section] || ['scroll'];
  }
  return map;
}

function _isConversionEvent(eventName, cgoal) {
  const CONVERSION_EVENTS = {
    lead:        ['Lead', 'generate_lead', 'CompleteRegistration', 'conversion'],
    purchase:    ['Purchase', 'purchase', 'conversion'],
    checkout:    ['InitiateCheckout', 'begin_checkout'],
    free:        ['Lead', 'generate_lead', 'CompleteRegistration'],
    webinar:     ['CompleteRegistration', 'generate_lead'],
    consultation:['Lead', 'generate_lead'],
  };
  const relevant = CONVERSION_EVENTS[cgoal] || CONVERSION_EVENTS.lead;
  return relevant.includes(eventName);
}

function _getPrimaryConversionEvent(requestedPixels, cgoal) {
  if (requestedPixels.includes('meta')) {
    return cgoal === 'purchase' ? 'Purchase' : 'Lead';
  }
  if (requestedPixels.includes('ga4')) {
    return cgoal === 'purchase' ? 'purchase' : 'generate_lead';
  }
  return 'Lead';
}

function _getAttributionWindow(productType) {
  return ['course', 'saas'].includes(productType) ? '7-day click, 1-day view' : '1-day click, 1-day view';
}

function _mapTriggerToSection(trigger, sections) {
  const map = {
    page_load:   'hero',
    scroll_50:   'proof',
    scroll_90:   'offer',
    form_submit: 'cta',
    cta_click:   'cta',
    purchase:    'cta',
    thank_you:   'cta',
    offer_view:  'offer',
    time_30s:    'proof',
    hover_cta:   'cta',
    video_click: 'hero',
  };
  return map[trigger] || 'body';
}

function _eventSnippet(pixel, event) {
  const snippets = {
    meta:       `fbq('track', '${event}');`,
    ga4:        `gtag('event', '${event}');`,
    google_ads: `gtag('event', 'conversion', { 'send_to': 'AW-XXXXXXXX/${event}' });`,
    tiktok:     `ttq.track('${event}');`,
  };
  return snippets[pixel] || `/* ${pixel} - ${event} */`;
}

module.exports = { buildTrackingLayer, PIXEL_EVENTS, FUNNEL_STAGE_EVENTS };
