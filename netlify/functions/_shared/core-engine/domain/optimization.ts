export interface PerformanceInput {
  ctr?: number;
  cpc?: number;
  cvr?: number;
  cpa?: number;
  roas?: number;
  bounceRate?: number;
  hookRate?: number;
  leadToCallRate?: number;
}

export interface DiagnosisItem {
  metric: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  finding: string;
  rootCause: string;
  businessMeaning: string;
  recommendedAction: string;
  priority: number;
  confidence: number;
  expectedImpact: 'high' | 'medium' | 'low';
}

export interface RegenerationBrief {
  assetType: 'ad' | 'landing_page' | 'video_script';
  reason: string;
  exactAction: string;
  priority: number;
}

export interface PerformanceDiagnosis {
  findings: string[];
  rootCauses: string[];
  recommendedActions: string[];
  priorityOrder: string[];
  issues?: DiagnosisItem[];
  regenerationBriefs?: RegenerationBrief[];
  professional: {
    diagnosis: string;
  };
  plainHebrew: string;
}
