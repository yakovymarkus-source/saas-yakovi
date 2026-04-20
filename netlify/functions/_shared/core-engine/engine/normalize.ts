import { NormalizedMetrics, RawMetrics } from '../types/domain';

function safe(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function normalizeMetrics(raw: RawMetrics): NormalizedMetrics {
  return {
    impressions: safe(raw.impressions),
    clicks: safe(raw.clicks),
    spend: safe(raw.spend),
    landingPageViews: safe(raw.landingPageViews),
    sessions: safe(raw.sessions),
    leads: safe(raw.leads),
    purchases: safe(raw.purchases),
    revenue: safe(raw.revenue),
    frequency: safe(raw.frequency),
    bounceRate: safe(raw.bounceRate),
    addToCart: safe(raw.addToCart),
    initiatedCheckout: safe(raw.initiatedCheckout)
  };
}
