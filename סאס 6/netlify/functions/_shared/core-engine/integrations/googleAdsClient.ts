import { env } from '../config/env';
import { RawMetrics } from '../types/domain';
import { externalGet } from './baseClient';

interface GoogleAdsRow {
  metrics?: {
    impressions?: string;
    clicks?: string;
    costMicros?: string;
    conversions?: string;
    conversionsValue?: string;
    videoViews?: string;
  };
}

interface GoogleAdsResponse {
  results?: GoogleAdsRow[];
}

export async function fetchGoogleAdsMetrics(_externalCampaignId: string): Promise<RawMetrics> {
  if (!env.GOOGLE_ADS_DEVELOPER_TOKEN || !env.GOOGLE_ADS_ACCESS_TOKEN || !env.GOOGLE_ADS_CUSTOMER_ID) {
    throw new Error('Google Ads integration is not configured');
  }
  const query = encodeURIComponent('SELECT metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value FROM campaign');
  const url = `https://googleads.googleapis.com/v18/customers/${env.GOOGLE_ADS_CUSTOMER_ID}/googleAds:searchStream?query=${query}`;
  const response = await externalGet<GoogleAdsResponse[]>('googleAds', url, {
    Accept: 'application/json',
    Authorization: `Bearer ${env.GOOGLE_ADS_ACCESS_TOKEN}`,
    'developer-token': env.GOOGLE_ADS_DEVELOPER_TOKEN
  });
  const metrics = response[0]?.results?.[0]?.metrics;
  if (!metrics) throw new Error('No Google Ads metrics returned');
  return {
    impressions: Number(metrics.impressions ?? 0),
    clicks: Number(metrics.clicks ?? 0),
    spend: Number(metrics.costMicros ?? 0) / 1_000_000,
    leads: Number(metrics.conversions ?? 0),
    revenue: Number(metrics.conversionsValue ?? 0)
  };
}
