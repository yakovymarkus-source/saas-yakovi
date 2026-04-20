import { env } from '../config/env';
import { RawMetrics } from '../types/domain';
import { externalGet } from './baseClient';

interface MetaInsightsResponse {
  data?: Array<Record<string, string>>;
}

export async function fetchMetaMetrics(externalCampaignId: string): Promise<RawMetrics> {
  if (!env.META_ACCESS_TOKEN || !env.META_AD_ACCOUNT_ID) {
    throw new Error('Meta integration is not configured');
  }
  const fields = ['impressions', 'clicks', 'spend', 'landing_page_views', 'actions', 'purchase_roas', 'frequency'];
  const url = `https://graph.facebook.com/v21.0/${externalCampaignId}/insights?fields=${fields.join(',')}&access_token=${encodeURIComponent(env.META_ACCESS_TOKEN)}`;
  const response = await externalGet<MetaInsightsResponse>('meta', url, { Accept: 'application/json' });
  const row = response.data?.[0];
  if (!row) throw new Error('No Meta campaign insights returned');
  const actions = Array.isArray((row as { actions?: Array<{ action_type: string; value: string }> }).actions)
    ? ((row as { actions?: Array<{ action_type: string; value: string }> }).actions ?? [])
    : [];
  const actionValue = (type: string) => Number(actions.find((item) => item.action_type === type)?.value ?? 0);
  return {
    impressions: Number(row.impressions ?? 0),
    clicks: Number(row.clicks ?? 0),
    spend: Number(row.spend ?? 0),
    landingPageViews: actionValue('landing_page_view'),
    leads: actionValue('lead'),
    purchases: actionValue('purchase'),
    frequency: Number(row.frequency ?? 0),
    revenue: Number(((row as { purchase_roas?: Array<{ value: string }> }).purchase_roas ?? [])[0]?.value ?? 0) * Number(row.spend ?? 0)
  };
}
