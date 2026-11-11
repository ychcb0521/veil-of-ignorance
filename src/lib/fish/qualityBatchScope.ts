import type { QualityScreeningScope } from './qualityScreeningResults';

export interface QualityBatchLock extends QualityScreeningScope {
  rowIds: string[];
  groupBySignal: boolean;
}

const keyFor = (owner?: string) => 'veil.fishQualityBatch.v1:' + (owner ?? 'local');

export function readQualityBatchLock(owner?: string): QualityBatchLock | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(keyFor(owner)) ?? 'null') as QualityBatchLock | null;
    return value && Array.isArray(value.rowIds) && value.rowIds.length > 0
      && value.rowIds.every(id => typeof id === 'string') ? value : null;
  } catch {
    return null;
  }
}

export function saveQualityBatchLock(owner: string | undefined, batch: QualityBatchLock | null): void {
  try {
    if (batch) sessionStorage.setItem(keyFor(owner), JSON.stringify(batch));
    else sessionStorage.removeItem(keyFor(owner));
  } catch { /* The lock still lives in the active panel. */ }
}

export function sameQualityBatch(left: readonly string[], right: readonly string[]): boolean {
  const ids = new Set(left);
  const other = new Set(right);
  return ids.size === other.size && right.every(id => ids.has(id));
}
