/**
 * tiktok.js — TikTok Ads OAuth token exchange
 *
 * Uses the TikTok for Business v2 API.
 * Docs: https://business-api.tiktok.com/portal/docs?id=1738373164380162
 */

const { AppError } = require('../errors');

const TOKEN_ENDPOINT = 'https://open.tiktokapis.com/v2/oauth/token/';

/**
 * Exchange an authorization code for an access token
 */
async function exchangeCodeForToken(code, redirectUri) {
  const clientKey    = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;

  if (!clientKey || !clientSecret) {
    throw new AppError({
      code:        'TIKTOK_NOT_CONFIGURED',
      userMessage: 'TikTok לא מוגדר',
      devMessage:  'TIKTOK_CLIENT_KEY or TIKTOK_CLIENT_SECRET missing',
      status:      500,
    });
  }

  const res = await fetch(TOKEN_ENDPOINT, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      client_key:    clientKey,
      client_secret: clientSecret,
      code,
      grant_type:    'authorization_code',
      redirect_uri:  redirectUri,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new AppError({
      code:        'TIKTOK_TOKEN_EXCHANGE_FAILED',
      userMessage: 'חיבור TikTok נכשל',
      devMessage:  err?.message || `HTTP ${res.status} from TikTok token endpoint`,
      status:      502,
    });
  }

  const body = await res.json();

  // TikTok v2 wraps data under body.data
  const data = body.data || body;

  if (!data.access_token) {
    throw new AppError({
      code:        'TIKTOK_TOKEN_EXCHANGE_FAILED',
      userMessage: 'חיבור TikTok נכשל',
      devMessage:  `No access_token in TikTok response: ${JSON.stringify(body)}`,
      status:      502,
    });
  }

  return {
    accessToken:        data.access_token,
    refreshToken:       data.refresh_token       || null,
    expiresIn:          data.expires_in          || null,
    refreshExpiresIn:   data.refresh_expires_in  || null,
    scope:              data.scope               || null,
  };
}

module.exports = { exchangeCodeForToken };
