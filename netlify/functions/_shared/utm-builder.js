'use strict';

/**
 * Appends UTM parameters + ad_id to a URL without overwriting existing params.
 * Safe for use in ad creation flows and landing page link generation.
 */
function appendUtm(baseUrl, params = {}) {
  if (!baseUrl) return baseUrl;
  try {
    const u = new URL(baseUrl);
    const add = {
      utm_source:   params.utm_source   || 'facebook',
      utm_medium:   params.utm_medium   || 'cpc',
      utm_campaign: params.utm_campaign || '',
      utm_content:  params.utm_content  || '',
      utm_term:     params.utm_term     || '',
      ad_id:        params.ad_id        || '',
      campaign_id:  params.campaign_id  || '',
    };
    // Only set if not already present (never overwrite user-set params)
    Object.entries(add).forEach(([k, v]) => {
      if (v && !u.searchParams.has(k)) u.searchParams.set(k, v);
    });
    return u.toString();
  } catch {
    // Fallback for relative URLs or malformed URLs
    const sep = baseUrl.includes('?') ? '&' : '?';
    const parts = [];
    const existing = baseUrl.split('?')[1] || '';
    const existingKeys = new Set(existing.split('&').map(p => p.split('=')[0]).filter(Boolean));
    const add = {
      utm_source:   params.utm_source   || 'facebook',
      utm_medium:   params.utm_medium   || 'cpc',
      utm_campaign: params.utm_campaign || '',
      utm_content:  params.utm_content  || '',
      ad_id:        params.ad_id        || '',
      campaign_id:  params.campaign_id  || '',
    };
    Object.entries(add).forEach(([k, v]) => {
      if (v && !existingKeys.has(k)) parts.push(`${k}=${encodeURIComponent(v)}`);
    });
    return parts.length ? baseUrl + sep + parts.join('&') : baseUrl;
  }
}

module.exports = { appendUtm };
