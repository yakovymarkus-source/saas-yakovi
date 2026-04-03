const { fetchMetaAdsData } = require('../integrations/metaAdsClient');
const { fetchGoogleAdsData } = require('../integrations/googleAdsClient');
const { fetchGa4Data } = require('../integrations/ga4Client');
const { buildProviderRuntimeConfig } = require('./providerConfig');

const providerExecutors = {
  meta_ads: fetchMetaAdsData,
  google_ads: fetchGoogleAdsData,
  ga4: fetchGa4Data
};

async function fetchProvider(provider, context) {
  const execute = providerExecutors[provider];
  if (!execute) {
    return {
      status: 'skipped',
      retry_count: 0,
      warnings: [`unsupported_provider:${provider}`],
      data: []
    };
  }
  return execute(context);
}

async function fetchAllData(input = {}, options = {}) {
  const providers = Array.isArray(input.providers) && input.providers.length
    ? input.providers
    : ['meta_ads', 'google_ads', 'ga4'];

  const runtimeConfig = buildProviderRuntimeConfig(options.runtimeConfig || input.runtimeConfig || {});
  const request_id = options.request_id;
  const bundle = { providers: {} };

  for (const provider of providers) {
    bundle.providers[provider] = await fetchProvider(provider, {
      input,
      runtimeConfig,
      request_id,
      logger: options.logger
    });
  }

  return bundle;
}

module.exports = {
  fetchAllData
};
