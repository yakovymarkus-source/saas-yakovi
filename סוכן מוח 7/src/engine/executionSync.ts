import { Action, ExecutionStatus, ExecutionSyncItem } from '../types/domain';

export interface ExecutionUpdateInput {
  actionCode: string;
  status: ExecutionStatus;
  executedAt?: string;
}

// In-memory sync store — keyed by analysisId
const syncStore: Record<string, ExecutionSyncItem[]> = {};

export function initExecutionSync(analysisId: string, actions: Action[]): ExecutionSyncItem[] {
  const items: ExecutionSyncItem[] = actions.map(action => ({
    actionCode: action.code,
    title: action.title,
    status: 'pending'
  }));
  syncStore[analysisId] = items;
  return items;
}

export function updateExecutionSync(analysisId: string, updates: ExecutionUpdateInput[]): ExecutionSyncItem[] {
  if (!syncStore[analysisId]) return [];
  for (const update of updates) {
    const item = syncStore[analysisId].find(i => i.actionCode === update.actionCode);
    if (item) {
      item.status = update.status;
      if (update.executedAt) item.executedAt = update.executedAt;
    }
  }
  return syncStore[analysisId];
}

export function getExecutionSync(analysisId: string): ExecutionSyncItem[] {
  return syncStore[analysisId] ?? [];
}

export function getPendingActions(analysisId: string): ExecutionSyncItem[] {
  return (syncStore[analysisId] ?? []).filter(i => i.status === 'pending');
}

export function getSyncSummary(analysisId: string): { total: number; executed: number; pending: number; skipped: number } {
  const items = syncStore[analysisId] ?? [];
  return {
    total: items.length,
    executed: items.filter(i => i.status === 'executed').length,
    pending: items.filter(i => i.status === 'pending').length,
    skipped: items.filter(i => i.status === 'skipped').length
  };
}
