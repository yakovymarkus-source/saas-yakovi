/**
 * ga4.js — Google Analytics 4 Data API v1 fetcher
 *
 * Requires an OAuth access_token with scope:
 *   https://www.googleapis.com/auth/analytics.readonly
 */

const { AppError } = require('../errors');

const GA4_API = 'https://analyticsdata.googleapis.com/v1beta';

/**
 * Run a report against a GA4 property.
 * @param {object} opts
 * @param {string} opts.accessToken   — OAuth2 access token
 * @param {string} opts.propertyId    — GA4 property ID (e.g. "properties/12345678")
 * @param {string} opts.startDate     — ISO date string e.g. "30daysAgo" | "2024-01-01"
 * @param {string} opts.endDate       — e.g. "today"
 * @param {string[]} opts.dimensions  — e.g. ['date', 'sessionDefaultChannelGroup']
 * @param {string[]} opts.metrics     — e.g. ['sessions', 'conversions', 'totalRevenue']
 */
async function runReport({ accessToken, propertyId, startDate = '30daysAgo', endDate = 'today', dimensions = [], metrics = [] }) {
  const propPath = propertyId.startsWith('properties/') ? propertyId : `properties/${propertyId}`;

  const body = {
    dateRanges: [{ startDate, endDate }],
    dimensions: dimensions.map(name => ({ name })),
    metrics:    metrics.map(name => ({ name })),
    limit: 10000,
  };

  const res = await fetch(`${GA4_API}/${propPath}:runReport`, {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new AppError({
      code:        'GA4_API_ERROR',
      userMessage: 'שגיאה בטעינת נתוני GA4',
      devMessage:  `GA4 runReport failed (${res.status}): ${err?.error?.message || ''}`,
      status:      502,
      details:     { propertyId, status: res.status },
    });
  }

  const data = await res.json();
  return parseReport(data);
}

function parseReport(raw) {
  const dimensionHeaders = (raw.dimensionHeaders || []).map(h => h.name);
  const metricHeaders    = (raw.metricHeaders    || []).map(h => h.name);

  const rows = (raw.rows || []).map(row => {
    const obj = {};
    (row.dimensionValues || []).forEach((v, i) => { obj[dimensionHeaders[i]] = v.value; });
    (row.metricValues    || []).forEach((v, i) => { obj[metricHeaders[i]]    = Number(v.value) || 0; });
    return obj;
  });

  return { rows, totals: raw.totals, rowCount: raw.rowCount || rows.length };
}

/**
 * Convenience: fetch standard campaign performance metrics
 */
async function fetchCampaignMetrics({ accessToken, propertyId, startDate, endDate }) {
  return runReport({
    accessToken,
    propertyId,
    startDate,
    endDate,
    dimensions: ['sessionCampaignName', 'sessionDefaultChannelGroup'],
    metrics:    ['sessions', 'conversions', 'totalRevenue', 'bounceRate', 'averageSessionDuration'],
  });
}

/**
 * List all accessible GA4 properties for a user
 */
async function listProperties(accessToken) {
  const res = await fetch('https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new AppError({
      code:        'GA4_ACCOUNTS_ERROR',
      userMessage: 'שגיאה בטעינת חשבונות GA4',
      devMessage:  `GA4 accountSummaries failed (${res.status}): ${err?.error?.message || ''}`,
      status:      502,
    });
  }
  const data = await res.json();
  const properties = [];
  for (const account of (data.accountSummaries || [])) {
    for (const prop of (account.propertySummaries || [])) {
      properties.push({
        propertyId:   prop.property,
        displayName:  prop.displayName,
        accountName:  account.displayName,
      });
    }
  }
  return properties;
}

module.exports = { runReport, fetchCampaignMetrics, listProperties };
