import { CampaignPayload, RawMetrics, SourcePlatform } from '../types/domain';
import { rawMetricsSchema } from './schemas';
import { fetchMetaMetrics } from './metaClient';
import { fetchGoogleAdsMetrics } from './googleAdsClient';
import { fetchGa4Metrics } from './ga4Client';

export async function resolveMetrics(input: {
  source: SourcePlatform;
  externalCampaignId?: string;
  campaign: CampaignPayload;
}): Promise<RawMetrics> {
  let rawMetrics: RawMetrics | undefined = input.campaign.manualMetrics;

  if (!rawMetrics && input.externalCampaignId) {
    rawMetrics = await (
      input.source === 'meta'
        ? fetchMetaMetrics(input.externalCampaignId)
        : input.source === 'googleAds'
          ? fetchGoogleAdsMetrics(input.externalCampaignId)
          : fetchGa4Metrics()
    );
  }

  if (!rawMetrics) {
    throw new Error('No metrics available. Provide manualMetrics or a valid external campaign id.');
  }

  return rawMetricsSchema.parse(rawMetrics);
}
