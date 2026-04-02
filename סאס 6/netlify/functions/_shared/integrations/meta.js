/**
 * meta.js — Meta (Facebook/Instagram) Ads Graph API fetcher
 *
 * Requires a user access token with ads_read, read_insights permissions.
 */

const { AppError } = require('../errors');
const { optionalEnv } = require('../env');

function graphBase() {
  const v = process.env.META_GRAPH_VERSION || 'v19.0';
  return `https://graph.facebook.com/${v}`;
}

async function graphGet(path, params, accessToken) {
  const url = new URL(`${graphBase()}/${path}`);
  url.searchParams.set('access_token', accessToken);
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString());
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new AppError({
      code:        'META_API_ERROR',
      userMessage: 'שגיאה בטעינת נתוני Meta',
      devMessage:  `Meta API ${path} failed (${res.status}): ${err?.error?.message || ''}`,
      status:      502,
      details:     { path, metaCode: err?.error?.code },
    });
  }
  return res.json();
}

/**
 * Fetch ad accounts accessible to the user
 */
async function listAdAccounts(accessToken) {
  const data = await graphGet('me/adaccounts', {
    fields: 'id,name,account_status,currency,timezone_name',
    limit:  200,
  }, accessToken);
  return (data.data || []).map(a => ({
    accountId:    a.id,
    name:         a.name,
    status:       a.account_status,
    currency:     a.currency,
    timezone:     a.timezone_name,
  }));
}

/**
 * Fetch campaign insights for an ad account
 * @param {string} accountId  — e.g. "act_123456789"
 * @param {string} datePreset — e.g. "last_30d", "last_7d", "this_month"
 */
async function fetchCampaignInsights({ accessToken, accountId, datePreset = 'last_30d', fields }) {
  const defaultFields = [
    'campaign_name', 'impressions', 'clicks', 'spend',
    'reach', 'cpc', 'cpm', 'ctr', 'conversions', 'actions',
  ].join(',');

  const data = await graphGet(`${accountId}/insights`, {
    level:       'campaign',
    date_preset: datePreset,
    fields:      fields || defaultFields,
    limit:       500,
  }, accessToken);

  return (data.data || []).map(row => ({
    campaignName: row.campaign_name,
    impressions:  Number(row.impressions || 0),
    clicks:       Number(row.clicks      || 0),
    spend:        Number(row.spend       || 0),
    reach:        Number(row.reach       || 0),
    cpc:          Number(row.cpc         || 0),
    cpm:          Number(row.cpm         || 0),
    ctr:          Number(row.ctr         || 0),
    conversions:  extractConversions(row.actions),
    raw:          row,
  }));
}

function extractConversions(actions) {
  if (!Array.isArray(actions)) return 0;
  const conv = actions.find(a => a.action_type === 'offsite_conversion.fb_pixel_purchase'
    || a.action_type === 'purchase'
    || a.action_type === 'lead');
  return conv ? Number(conv.value || 0) : 0;
}

/**
 * Exchange a short-lived code for a long-lived user access token
 */
async function exchangeCodeForToken(code, redirectUri) {
  const appId     = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) throw new AppError({ code: 'META_NOT_CONFIGURED', userMessage: 'Meta לא מוגדר', devMessage: 'META_APP_ID or META_APP_SECRET missing', status: 500 });

  // Step 1: get short-lived token
  const shortRes = await fetch(`${graphBase()}/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code }),
  });
  if (!shortRes.ok) {
    const err = await shortRes.json().catch(() => ({}));
    throw new AppError({ code: 'META_TOKEN_EXCHANGE_FAILED', userMessage: 'חיבור Meta נכשל', devMessage: err?.error?.message || 'Short token exchange failed', status: 502 });
  }
  const { access_token: shortToken } = await shortRes.json();

  // Step 2: exchange for long-lived token (60 days)
  const longUrl = new URL(`${graphBase()}/oauth/access_token`);
  longUrl.searchParams.set('grant_type',        'fb_exchange_token');
  longUrl.searchParams.set('client_id',         appId);
  longUrl.searchParams.set('client_secret',     appSecret);
  longUrl.searchParams.set('fb_exchange_token', shortToken);

  const longRes = await fetch(longUrl.toString());
  if (!longRes.ok) {
    const err = await longRes.json().catch(() => ({}));
    throw new AppError({ code: 'META_TOKEN_EXCHANGE_FAILED', userMessage: 'חיבור Meta נכשל', devMessage: err?.error?.message || 'Long token exchange failed', status: 502 });
  }
  const { access_token, expires_in } = await longRes.json();
  return { accessToken: access_token, expiresIn: expires_in };
}

module.exports = { listAdAccounts, fetchCampaignInsights, exchangeCodeForToken };
