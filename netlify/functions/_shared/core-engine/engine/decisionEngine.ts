import { engineConfig } from '../config/engineConfig';
import {
  CampaignPayload,
  ComputedMetrics,
  EngineResult,
  Issue,
  NormalizedMetrics,
  Action,
  VerdictType
} from '../types/domain';
import { ENGINE_VERSION } from './versioning';

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function createIssue(input: Issue): Issue {
  return input;
}

function weightedSeverity(stage: keyof typeof engineConfig.weights, baseSeverity: number): number {
  return Number((baseSeverity * engineConfig.weights[stage]).toFixed(2));
}

function detectSignals(campaign: CampaignPayload, metrics: NormalizedMetrics, computed: ComputedMetrics): Issue[] {
  const signals: Issue[] = [];

  if (computed.ctr < engineConfig.thresholds.ctrCritical) {
    signals.push(createIssue({
      code: 'creative_ctr_critical',
      verdictType: 'Creative failure',
      severity: weightedSeverity('creative', 95),
      confidence: 0.92,
      stage: 'creative',
      reason: 'CTR is critically below threshold.',
      evidence: [`CTR=${computed.ctr.toFixed(4)}`, `Threshold=${engineConfig.thresholds.ctrCritical}`]
    }));
  } else if (computed.ctr < engineConfig.thresholds.ctrLow) {
    signals.push(createIssue({
      code: 'creative_ctr_low',
      verdictType: 'Creative failure',
      severity: weightedSeverity('creative', 70),
      confidence: 0.78,
      stage: 'creative',
      reason: 'CTR is below the healthy band.',
      evidence: [`CTR=${computed.ctr.toFixed(4)}`]
    }));
  }

  if (metrics.frequency > engineConfig.thresholds.frequencyHigh && computed.ctr < engineConfig.thresholds.ctrLow) {
    signals.push(createIssue({
      code: 'audience_fatigue',
      verdictType: 'Audience mismatch',
      severity: weightedSeverity('audience', 82),
      confidence: 0.81,
      stage: 'audience',
      reason: 'Frequency is high while CTR remains weak.',
      evidence: [`Frequency=${metrics.frequency.toFixed(2)}`, `CTR=${computed.ctr.toFixed(4)}`]
    }));
  }

  if (
    metrics.bounceRate > engineConfig.thresholds.bounceRateHigh ||
    computed.landingPageDropoffRate > engineConfig.thresholds.landingPageDropoffHigh ||
    computed.sessionDropoffRate > engineConfig.thresholds.sessionDropoffHigh
  ) {
    signals.push(createIssue({
      code: 'landing_page_dropoff',
      verdictType: 'Landing page issue',
      severity: weightedSeverity('landingPage', 88),
      confidence: 0.86,
      stage: 'landing_page',
      reason: 'Users are dropping before meaningful session depth.',
      evidence: [
        `BounceRate=${metrics.bounceRate.toFixed(2)}`,
        `LPDropoff=${computed.landingPageDropoffRate.toFixed(2)}`,
        `SessionDropoff=${computed.sessionDropoffRate.toFixed(2)}`
      ]
    }));
  }

  if (
    (computed.cpa !== null && computed.cpa > engineConfig.thresholds.cpaHigh) ||
    (computed.roas !== null && computed.roas < engineConfig.thresholds.roasLow)
  ) {
    signals.push(createIssue({
      code: 'budget_efficiency',
      verdictType: 'Budget inefficiency',
      severity: weightedSeverity('budget', 84),
      confidence: 0.8,
      stage: 'budget',
      reason: 'Cost structure is not justified by outcome.',
      evidence: [`CPA=${computed.cpa ?? 'n/a'}`, `ROAS=${computed.roas ?? 'n/a'}`]
    }));
  }

  if (!signals.length) {
    signals.push(createIssue({
      code: 'healthy_campaign',
      verdictType: 'Budget inefficiency',
      severity: weightedSeverity('budget', 15),
      confidence: 0.66,
      stage: 'budget',
      reason: `Campaign ${campaign.name} does not show a dominant failure pattern.`,
      evidence: ['Metrics remained within configured thresholds.']
    }));
  }

  return signals.sort((a, b) => b.severity - a.severity);
}

function buildActions(signals: Issue[]): Action[] {
  return signals
    .map((item, index) => {
      const actionMap: Record<VerdictType, Omit<Action, 'priorityScore' | 'code'>> = {
        'Creative failure': {
          title: 'Replace the current creative set',
          why: 'Weak click intent signals ad-message mismatch.',
          expectedImpact: 'Higher CTR and lower CPC.',
          impact: 9,
          effort: 5,
          urgency: 9
        },
        'Audience mismatch': {
          title: 'Tighten targeting and exclude fatigued segments',
          why: 'High frequency with weak response usually means audience saturation.',
          expectedImpact: 'Cleaner traffic quality and better conversion rate.',
          impact: 8,
          effort: 4,
          urgency: 8
        },
        'Landing page issue': {
          title: 'Rebuild above-the-fold offer clarity',
          why: 'Drop-off before session depth means the page is leaking intent.',
          expectedImpact: 'Lower bounce and more lead completion.',
          impact: 10,
          effort: 6,
          urgency: 10
        },
        'Budget inefficiency': {
          title: 'Reallocate budget toward efficient segments only',
          why: 'Spend is outrunning measurable return.',
          expectedImpact: 'Lower CPA or improved ROAS.',
          impact: 8,
          effort: 3,
          urgency: 8
        }
      };

      const base = actionMap[item.verdictType];
      const priorityScore =
        base.impact * engineConfig.actionPriority.impactWeight +
        (10 - base.effort) * engineConfig.actionPriority.effortWeight +
        base.urgency * engineConfig.actionPriority.urgencyWeight;

      return {
        code: `${item.code}_action_${index + 1}`,
        ...base,
        priorityScore: Number(priorityScore.toFixed(2))
      };
    })
    .sort((a, b) => b.priorityScore - a.priorityScore);
}

export function runDecisionEngine(
  campaign: CampaignPayload,
  metrics: NormalizedMetrics,
  computed: ComputedMetrics
): EngineResult {
  const issues = detectSignals(campaign, metrics, computed);
  const top = issues[0];
  const confidence = Number(
    clamp(issues.reduce((sum, item) => sum + item.confidence, 0) / issues.length).toFixed(2)
  );

  return {
    verdict: top.verdictType,
    confidence,
    metrics: computed,
    normalizedMetrics: metrics,
    issues,
    prioritizedActions: buildActions(issues),
    decisionLog: {
      appliedThresholds: engineConfig.thresholds,
      weights: engineConfig.weights,
      strongestIssue: top.code,
      engineVersion: ENGINE_VERSION
    }
  };
}

export { ENGINE_VERSION };
