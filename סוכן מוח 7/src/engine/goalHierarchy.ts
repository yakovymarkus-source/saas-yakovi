import { CampaignObjective, ComputedMetrics, GoalHierarchy, GoalLevel, GoalStatus, NormalizedMetrics } from '../types/domain';

function goalStatus(value: number | null, target: number, higherIsBetter: boolean): GoalStatus {
  if (value === null) return 'off_track';
  const ratio = value / target;
  if (higherIsBetter) {
    if (ratio >= 0.9) return 'on_track';
    if (ratio >= 0.6) return 'at_risk';
    return 'off_track';
  } else {
    if (ratio <= 1.1) return 'on_track';
    if (ratio <= 1.5) return 'at_risk';
    return 'off_track';
  }
}

function makeGoal(name: string, metric: string, value: number | null, target: number, higherIsBetter: boolean): GoalLevel {
  return { name, metric, value, target, status: goalStatus(value, target, higherIsBetter) };
}

export function buildGoalHierarchy(objective: CampaignObjective, computed: ComputedMetrics, normalized: NormalizedMetrics): GoalHierarchy {
  const { cpa, roas, ctr, cpc, conversionRate } = computed;
  const { spend, revenue, leads, purchases } = normalized;

  switch (objective) {
    case 'lead_generation':
      return {
        primary: makeGoal('עלות לליד', 'CPL', cpa, 50, false),
        secondary: [
          makeGoal('לידים', 'leads', leads, 50, true),
          makeGoal('אחוז המרה', 'conversionRate', conversionRate * 100, 3, true)
        ],
        operational: [
          makeGoal('CTR', 'ctr', ctr * 100, 1.5, true),
          makeGoal('CPC', 'cpc', cpc, 5, false)
        ]
      };

    case 'sales':
      return {
        primary: makeGoal('ROAS', 'roas', roas, 3, true),
        secondary: [
          makeGoal('הכנסה', 'revenue', revenue, spend * 3, true),
          makeGoal('רכישות', 'purchases', purchases, 10, true)
        ],
        operational: [
          makeGoal('CTR', 'ctr', ctr * 100, 2, true),
          makeGoal('עלות לרכישה', 'cpa', cpa, 100, false)
        ]
      };

    case 'traffic':
      return {
        primary: makeGoal('CTR', 'ctr', ctr * 100, 2, true),
        secondary: [
          makeGoal('קליקים', 'clicks', normalized.clicks, 500, true),
          makeGoal('CPC', 'cpc', cpc, 3, false)
        ],
        operational: [
          makeGoal('חשיפות', 'impressions', normalized.impressions, 50000, true),
          makeGoal('תדירות', 'frequency', normalized.frequency, 3, false)
        ]
      };

    case 'awareness':
    default:
      return {
        primary: makeGoal('חשיפות', 'impressions', normalized.impressions, 100000, true),
        secondary: [
          makeGoal('תדירות', 'frequency', normalized.frequency, 4, false),
          makeGoal('מעורבות', 'engagement', normalized.clicks, 1000, true)
        ],
        operational: [
          makeGoal('CPM', 'cpm', spend > 0 && normalized.impressions > 0 ? (spend / normalized.impressions) * 1000 : null, 20, false)
        ]
      };
  }
}
