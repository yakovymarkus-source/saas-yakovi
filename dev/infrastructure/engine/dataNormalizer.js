function ensureNumber(value, fallback = 0) {
  const next = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function normalizeDataPoints(provider, rawData) {
  const items = Array.isArray(rawData) ? rawData : [];
  const capturedAt = new Date().toISOString();

  return items
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      key: String(item.key || item.metric || item.name || 'unknown'),
      value: ensureNumber(item.value ?? item.metricValue ?? item.amount ?? item.count),
      source: String(item.source || provider),
      captured_at: item.captured_at && !Number.isNaN(Date.parse(item.captured_at)) ? item.captured_at : capturedAt
    }));
}

function normalizeProviderResult(provider, fetched) {
  const safe = fetched && typeof fetched === 'object' ? fetched : {};

  return {
    provider,
    status: safe.status === 'error' ? 'error' : safe.status === 'skipped' ? 'skipped' : 'ok',
    retry_count: Number.isInteger(safe.retry_count) && safe.retry_count >= 0 ? safe.retry_count : 0,
    data_points: normalizeDataPoints(provider, safe.data),
    warnings: Array.isArray(safe.warnings) ? safe.warnings.map(String) : []
  };
}

function buildSummary(providers) {
  return providers.reduce(
    (acc, provider) => {
      acc.total_points += provider.data_points.length;
      if (provider.status === 'ok') acc.providers_ok += 1;
      if (provider.status === 'skipped') acc.providers_skipped += 1;
      if (provider.status === 'error') acc.providers_error += 1;
      return acc;
    },
    { total_points: 0, providers_ok: 0, providers_skipped: 0, providers_error: 0 }
  );
}

function normalizeFetchedBundle(bundle) {
  const safe = bundle && typeof bundle === 'object' ? bundle : {};
  const providers = Object.entries(safe.providers || {}).map(([provider, fetched]) => normalizeProviderResult(provider, fetched));

  return {
    providers,
    retry_count: providers.reduce((sum, item) => sum + item.retry_count, 0),
    status: providers.some((item) => item.status === 'error')
      ? providers.some((item) => item.status === 'ok') ? 'partial' : 'error'
      : 'ok',
    summary: buildSummary(providers)
  };
}

module.exports = {
  normalizeFetchedBundle,
  normalizeProviderResult,
  normalizeDataPoints
};
