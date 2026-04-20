import { KnownPattern, PatternMatch, VerdictType } from '../types/domain';

export interface MemoryEntry {
  campaignId: string;
  userId: string;
  verdict: VerdictType;
  confidence: number;
  topIssueCode: string;
  patternIds: string[];
  timestamp: string;
}

export interface LearningInsight {
  patternId: string;
  occurrences: number;
  avgConfidence: number;
  lastSeen: string;
  trend: 'rising' | 'stable' | 'declining';
}

// In-memory store — in production this should persist to DB via analysisRepository
const memoryStore: MemoryEntry[] = [];

export function recordMemory(entry: MemoryEntry): void {
  memoryStore.push(entry);
  // Keep last 1000 entries in-process
  if (memoryStore.length > 1000) memoryStore.shift();
}

export function getLearningInsights(userId: string): LearningInsight[] {
  const userEntries = memoryStore.filter(e => e.userId === userId);
  if (userEntries.length < 3) return [];

  const patternCounts: Record<string, MemoryEntry[]> = {};
  for (const entry of userEntries) {
    for (const pid of entry.patternIds) {
      if (!patternCounts[pid]) patternCounts[pid] = [];
      patternCounts[pid].push(entry);
    }
  }

  return Object.entries(patternCounts)
    .filter(([, entries]) => entries.length >= 2)
    .map(([patternId, entries]) => {
      const sorted = [...entries].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      const recent = sorted.slice(-3);
      const older = sorted.slice(0, -3);
      const recentCount = recent.length;
      const olderCount = older.length;
      const trend: LearningInsight['trend'] =
        recentCount > olderCount ? 'rising' : recentCount < olderCount ? 'declining' : 'stable';

      return {
        patternId,
        occurrences: entries.length,
        avgConfidence: Number((entries.reduce((s, e) => s + e.confidence, 0) / entries.length).toFixed(2)),
        lastSeen: sorted[sorted.length - 1].timestamp,
        trend
      };
    })
    .sort((a, b) => b.occurrences - a.occurrences);
}

export function enrichPatternsWithMemory(matches: PatternMatch[], userId: string): PatternMatch[] {
  const insights = getLearningInsights(userId);
  return matches.map(match => {
    const insight = insights.find(i => i.patternId === match.pattern.id);
    if (!insight) return match;

    // בונוס ביטחון אם הדפוס חוזר
    const bonus = Math.min(0.1, insight.occurrences * 0.02);
    return {
      ...match,
      matchScore: Number(Math.min(1, match.matchScore + bonus).toFixed(2)),
      pattern: {
        ...match.pattern,
        diagnosis: insight.trend === 'rising'
          ? `${match.pattern.diagnosis} (דפוס חוזר ומחמיר — ${insight.occurrences} פעמים)`
          : match.pattern.diagnosis
      } as KnownPattern
    };
  });
}
