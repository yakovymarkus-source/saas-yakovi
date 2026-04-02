export interface HumanExplanation<T> {
  professional: T;
  plainHebrew: string;
}

export interface StrategyVerdict {
  targetAudience: string;
  angle: string;
  offerType: string;
  funnelType: string;
  landingPageType: string;
  firstAssetToLaunch: string;
  reasoning: string[];
  rejectedOptions?: string[];
  confidenceScore?: number;
  ctaDirection?: string;
  status?: 'approved' | 'rejected';
}
