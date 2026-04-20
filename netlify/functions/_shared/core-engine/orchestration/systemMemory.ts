import { CampaignSession, LongTermInsight } from './types';
import { logActivity } from './activityLog';

export function saveShortTerm(session: CampaignSession, key: string, value: unknown): void {
  session.memory.shortTerm[key] = value;
  session.memory.lastUpdated = new Date().toISOString();
}

export function getShortTerm<T = unknown>(session: CampaignSession, key: string): T | undefined {
  return session.memory.shortTerm[key] as T | undefined;
}

export function saveInsight(
  session: CampaignSession,
  niche: string,
  type: LongTermInsight['type'],
  content: string,
  confidence: number
): void {
  const existing = session.memory.longTerm.find(i => i.niche === niche && i.type === type && i.content === content);
  if (existing) {
    existing.occurrences += 1;
    existing.confidence = Math.min(1, existing.confidence + 0.05);
    existing.lastSeen = new Date().toISOString();
  } else {
    session.memory.longTerm.push({
      niche,
      type,
      content,
      occurrences: 1,
      lastSeen: new Date().toISOString(),
      confidence
    });
  }
  logActivity(session, 'memory_saved', `Insight saved: [${type}] ${content.slice(0, 60)}`, {
    metadata: { niche, type, confidence }
  });
}

export function getTopInsights(session: CampaignSession, niche: string, limit = 5): LongTermInsight[] {
  return session.memory.longTerm
    .filter(i => i.niche === niche)
    .sort((a, b) => b.occurrences - a.occurrences || b.confidence - a.confidence)
    .slice(0, limit);
}

export function buildMemoryContext(session: CampaignSession): string {
  const niche = String(session.memory.shortTerm['businessCategory'] ?? 'general');
  const insights = getTopInsights(session, niche);
  if (!insights.length) return '';

  const lines = insights.map(i => `[${i.type}] ${i.content} (x${i.occurrences}, confidence ${(i.confidence * 100).toFixed(0)}%)`);
  return `לקחים מהעבר:\n${lines.join('\n')}`;
}

export function hasEnoughData(session: CampaignSession): boolean {
  const hasResearch = Boolean(session.memory.shortTerm['marketResearch']);
  const hasStrategy = Boolean(session.memory.shortTerm['strategy']);
  const hasAssets = Boolean(session.memory.shortTerm['assets']);
  return hasResearch && hasStrategy && hasAssets;
}

export function hasAnalysisData(session: CampaignSession): boolean {
  return Boolean(session.memory.shortTerm['lastAnalysisResult']);
}
