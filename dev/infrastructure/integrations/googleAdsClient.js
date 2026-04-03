async function fetchGoogleAdsData({ input = {}, request_id }) {
  const data = Array.isArray(input.googleAdsData) ? input.googleAdsData : [];
  return {
    status: data.length ? 'ok' : 'skipped',
    retry_count: 0,
    warnings: data.length ? [] : ['google_ads_no_data'],
    data,
    request_id
  };
}

module.exports = {
  fetchGoogleAdsData
};
