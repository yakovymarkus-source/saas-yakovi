'use strict';

/**
 * research/pii-filter.js
 * Strips personally identifiable information before storing signals.
 */

const EMAIL_RE    = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE    = /(\+?\d[\d\s\-().]{7,}\d)/g;
const USERNAME_RE = /@[\w._]{2,}/g;
const URL_PERSONAL_RE = /https?:\/\/(www\.)?(facebook\.com|instagram\.com|tiktok\.com)\/[^\s/]+/gi;

function filterText(text) {
  if (!text) return text;
  return text
    .replace(EMAIL_RE,        '[email]')
    .replace(PHONE_RE,        '[phone]')
    .replace(USERNAME_RE,     '[user]')
    .replace(URL_PERSONAL_RE, '[profile-url]')
    .trim();
}

function filterSignals(signals) {
  return signals.map(s => ({ ...s, text: filterText(s.text), context: filterText(s.context) }));
}

module.exports = { filterText, filterSignals };
