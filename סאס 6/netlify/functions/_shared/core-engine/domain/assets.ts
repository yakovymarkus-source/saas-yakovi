export type AssetScoreStatus = 'pass' | 'improve' | 'reject';

export interface AssetQualityScore {
  clarity: number;
  specificity: number;
  emotionalImpact: number;
  conversionStrength: number;
  strategyAlignment: number;
  total: number;
  status: AssetScoreStatus;
  reasons: string[];
  blockedBy?: string[];
}

export interface AssetIterationMeta {
  assetType: CampaignAssetType;
  attempt: number;
  maxAttempts: number;
  passed: boolean;
  improvementApplied?: boolean;
  reasons: string[];
}

export interface LandingPageBlueprint {
  sections: Array<{
    id: string;
    purpose: string;
    headlineGoal: string;
    contentRequirements: string[];
  }>;
  conversionGoal: 'lead' | 'sale' | 'booking';
}

export interface LandingPageCopy {
  heroHeadline: string;
  heroSubheadline: string;
  bullets: string[];
  bodySections: Array<{
    title: string;
    body: string;
  }>;
  ctas: string[];
  faq: Array<{ q: string; a: string }>;
  qualityScore?: AssetQualityScore;
  iteration?: AssetIterationMeta;
  selected?: boolean;
}

export interface RankedVariant {
  id: string;
  rank: number;
  total: number;
  status: AssetScoreStatus;
  strategicFit: number;
  selected: boolean;
}

export interface AdCreativePack {
  ads: Array<{
    platform: 'facebook' | 'instagram' | 'tiktok' | 'google';
    angle: string;
    hook: string;
    primaryText: string;
    headline: string;
    description?: string;
    cta: string;
    awarenessStage?: string;
    variationTheme?: string;
    qualityScore?: AssetQualityScore;
    selected?: boolean;
    versionLabel?: string;
  }>;
  rankings?: RankedVariant[];
  selectedVariantId?: string;
  iteration?: AssetIterationMeta;
}

export interface VideoScriptPack {
  scripts: Array<{
    format: 'ugc' | 'founder' | 'problem-solution' | 'testimonial' | 'direct-response';
    hook: string;
    body: string;
    cta: string;
    shotNotes: string[];
    pacing?: string[];
    sceneIntent?: string[];
    qualityScore?: AssetQualityScore;
    selected?: boolean;
    versionLabel?: string;
  }>;
  rankings?: RankedVariant[];
  selectedVariantId?: string;
  iteration?: AssetIterationMeta;
}

export type CampaignAssetType = 'landing_page' | 'ad' | 'video_script';

export interface VersionedAsset {
  id: string;
  campaignId: string;
  type: CampaignAssetType;
  version: number;
  angle: string;
  content: unknown;
  createdAt: string;
}
