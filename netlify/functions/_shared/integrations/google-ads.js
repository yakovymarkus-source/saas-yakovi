/**
 * google-ads.js — Google Ads API v17 fetcher (REST)
 *
 * Requires:
 *   - GOOGLE_ADS_DEVELOPER_TOKEN env var
 *   - An OAuth access token with scope: https://www.googleapis.com/auth/adwords
 *   - A manager (MCC) customer ID if using a manager account
 */

const { AppError } = require('../errors');

const ADS_API_VERSION = 'v17';
const BASE_URL = `https://googleads.googleapis.com/${ADS_API_VERSION}`;

function adsHeaders(accessToken, loginCustomerId) {
  const h = {
    Authorization:              `Bearer ${accessToken}`,
    'developer-token':          process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '',
    'Content-Type':             'application/json',
  };
  if (loginCustomerId) h['login-customer-id'] = String(loginCustomerId).replace(/-/g, '');
  return h;
}

async function adsPost(customerId, resource, body, accessToken, loginCustomerId) {
  const cid = String(customerId).replace(/-/g, '');
  const url  = `${BASE_URL}/customers/${cid}/${resource}`;
  const res  = await fetch(url, {
    method:  'POST',
    headers: adsHeaders(accessToken, loginCustomerId),
    body:    JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err?.error?.message || err?.error?.details?.[0]?.errors?.[0]?.message || '';
    throw new AppError({
      code:        'GOOGLE_ADS_API_ERROR',
      userMessage: 'שגיאה בטעינת נתוני Google Ads',
      devMessage:  `Google Ads ${resource} failed (${res.status}): ${msg}`,
      status:      502,
      details:     { customerId, status: res.status },
    });
  }
  return res.json();
}

/**
 * List accessible customer IDs for the authenticated user
 */
async function listAccessibleCustomers(accessToken) {
  const res = await fetch(`${BASE_URL}/customers:listAccessibleCustomers`, {
    headers: adsHeaders(accessToken),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new AppError({
      code:        'GOOGLE_ADS_CUSTOMERS_ERROR',
      userMessage: 'שגיאה בטעינת חשבונות Google Ads',
      devMessage:  `listAccessibleCustomers failed (${res.status}): ${err?.error?.message || ''}`,
      status:      502,
    });
  }
  const data = await res.json();
  return (data.resourceNames || []).map(r => r.replace('customers/', ''));
}

/**
 * Fetch campaign performance metrics via GAQL
 * @param {string}  customerId       — Google Ads customer ID
 * @param {string}  accessToken      — OAuth access token
 * @param {string}  [loginCustomerId]— Manager account ID (if applicable)
 * @param {string}  [startDate]      — YYYY-MM-DD
 * @param {string}  [endDate]        — YYYY-MM-DD
 */
async function fetchCampaignMetrics({ customerId, accessToken, loginCustomerId, startDate, endDate }) {
  const end   = endDate   || today();
  const start = startDate || daysAgo(30);

  const query = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      metrics.conversions_value,
      metrics.ctr,
      metrics.average_cpc
    FROM campaign
    WHERE segments.date BETWEEN '${start}' AND '${end}'
      AND campaign.status != 'REMOVED'
    ORDER BY metrics.cost_micros DESC
    LIMIT 500
  `;

  const data = await adsPost(customerId, 'googleAds:search', { query }, accessToken, loginCustomerId);

  return (data.results || []).map(row => ({
    campaignId:       row.campaign?.id,
    campaignName:     row.campaign?.name,
    status:           row.campaign?.status,
    impressions:      Number(row.metrics?.impressions || 0),
    clicks:           Number(row.metrics?.clicks      || 0),
    costMicros:       Number(row.metrics?.costMicros  || 0),
    spend:            Number(row.metrics?.costMicros  || 0) / 1_000_000,
    conversions:      Number(row.metrics?.conversions || 0),
    conversionsValue: Number(row.metrics?.conversionsValue || 0),
    ctr:              Number(row.metrics?.ctr          || 0),
    avgCpc:           Number(row.metrics?.averageCpc   || 0) / 1_000_000,
  }));
}

/**
 * Exchange Google auth code for access + refresh tokens
 */
async function exchangeCodeForTokens(code, redirectUri) {
  const clientId     = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new AppError({ code: 'GOOGLE_NOT_CONFIGURED', userMessage: 'Google לא מוגדר', devMessage: 'GOOGLE_OAUTH_CLIENT_ID or SECRET missing', status: 500 });
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id:     clientId,
      client_secret: clientSecret,
      redirect_uri:  redirectUri,
      grant_type:    'authorization_code',
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new AppError({ code: 'GOOGLE_TOKEN_EXCHANGE_FAILED', userMessage: 'חיבור Google נכשל', devMessage: err?.error_description || 'Token exchange failed', status: 502 });
  }
  const { access_token, refresh_token, expires_in } = await res.json();
  return { accessToken: access_token, refreshToken: refresh_token, expiresIn: expires_in };
}

/**
 * Refresh an expired access token using the stored refresh token
 */
async function refreshAccessToken(refreshToken) {
  const clientId     = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id:     clientId,
      client_secret: clientSecret,
      grant_type:    'refresh_token',
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new AppError({ code: 'GOOGLE_REFRESH_FAILED', userMessage: 'חיבור Google פג תוקף', devMessage: err?.error_description || 'Refresh failed', status: 401 });
  }
  const { access_token, expires_in } = await res.json();
  return { accessToken: access_token, expiresIn: expires_in };
}

function today()       { return new Date().toISOString().slice(0, 10); }
function daysAgo(n)    { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); }

module.exports = { listAccessibleCustomers, fetchCampaignMetrics, exchangeCodeForTokens, refreshAccessToken };
