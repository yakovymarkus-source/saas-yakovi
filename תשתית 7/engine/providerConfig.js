function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

function buildProviderRuntimeConfig(config = {}) {
  const safe = asObject(config);
  const http = asObject(safe.http);
  const metaAds = asObject(safe.metaAds);
  const googleAds = asObject(safe.googleAds);
  const ga4 = asObject(safe.ga4);

  return {
    http: {
      retryBaseDelayMs: Number(firstDefined(http.retryBaseDelayMs, safe.retryBaseDelayMs, 50)),
      retryMaxDelayMs: Number(firstDefined(http.retryMaxDelayMs, safe.retryMaxDelayMs, 500))
    },
    metaAds: {
      accessToken: firstDefined(metaAds.accessToken, safe.metaAccessToken, safe.accessToken),
      accountId: firstDefined(metaAds.accountId, safe.metaAccountId),
      maxPages: Number(firstDefined(metaAds.maxPages, safe.maxPages, 20))
    },
    googleAds: {
      accessToken: firstDefined(googleAds.accessToken, safe.googleAccessToken, safe.accessToken),
      developerToken: firstDefined(googleAds.developerToken, safe.googleDeveloperToken, safe.developerToken),
      customerId: firstDefined(googleAds.customerId, safe.googleCustomerId, safe.customerId),
      loginCustomerId: firstDefined(googleAds.loginCustomerId, safe.loginCustomerId)
    },
    ga4: {
      accessToken: firstDefined(ga4.accessToken, safe.ga4AccessToken, safe.accessToken),
      propertyId: firstDefined(ga4.propertyId, safe.ga4PropertyId, safe.propertyId)
    }
  };
}

function hasProviderCredentials(provider, runtimeConfig = {}) {
  const safe = asObject(runtimeConfig);
  switch (provider) {
    case 'meta_ads':
      return Boolean(asObject(safe.metaAds).accessToken && asObject(safe.metaAds).accountId);
    case 'google_ads': {
      const cfg = asObject(safe.googleAds);
      return Boolean(cfg.accessToken && cfg.developerToken && cfg.customerId);
    }
    case 'ga4': {
      const cfg = asObject(safe.ga4);
      return Boolean(cfg.accessToken && cfg.propertyId);
    }
    default:
      return false;
  }
}

module.exports = {
  buildProviderRuntimeConfig,
  hasProviderCredentials
};
