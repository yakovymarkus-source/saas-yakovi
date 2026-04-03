async function fetchGa4Data({ input = {}, request_id }) {
  const data = Array.isArray(input.ga4Data) ? input.ga4Data : [];
  return {
    status: data.length ? 'ok' : 'skipped',
    retry_count: 0,
    warnings: data.length ? [] : ['ga4_no_data'],
    data,
    request_id
  };
}

module.exports = {
  fetchGa4Data
};
