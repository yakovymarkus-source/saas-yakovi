async function fetchMetaAdsData({ input = {}, request_id }) {
  const data = Array.isArray(input.metaAdsData) ? input.metaAdsData : [];
  return {
    status: data.length ? 'ok' : 'skipped',
    retry_count: 0,
    warnings: data.length ? [] : ['meta_ads_no_data'],
    data,
    request_id
  };
}

module.exports = {
  fetchMetaAdsData
};
