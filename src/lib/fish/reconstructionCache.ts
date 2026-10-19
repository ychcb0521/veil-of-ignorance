/** Local-only reconstruction cache. Never use sim_* keys or persisted-state/cloud writers here. */
import { definitionKey, type DeepDigFeatureDef } from '@/lib/deepDig/features';
import type { TradeSignal } from '@/lib/signalLibrary';
import { shortFishHash } from './algorithm';
import type { FishReconstructionResult } from './reconstruction';
import type { FishPreference } from './preferences';

export interface ReconstructionCard { id: string; featureId: string; enabled: boolean; pref: FishPreference }
export interface ReconstructionCache { version: 1; key: string; result: FishReconstructionResult }
export const reconstructionStorageKey = (account: string | undefined) => `veil:fish-reconstruction:v1:${encodeURIComponent(account ?? 'anonymous')}`;
export function reconstructionCacheKey(account: string | undefined, cards: readonly ReconstructionCard[], defs: readonly DeepDigFeatureDef[], signals: readonly TradeSignal[]): string {
  const algorithms = cards.map(c => {
    const d = defs.find(d => d.id === c.featureId);
    return [c.featureId, c.enabled, c.pref.statistic ?? '结果', c.pref.direction, c.pref.threshold,
      d ? definitionKey(d) : null, d?.scale, d?.unit, '结果', '>'];
  });
  // Include identity/source fields used by adapters, not ratings or UI-only notes.
  const samples = signals.map(s => [s.id, s.exchange ?? 'binance', s.market ?? 'crypto', s.symbol, s.underlying ?? '', s.timeMs])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return shortFishHash(JSON.stringify([1, account ?? 'anonymous', algorithms, samples]));
}
export function readReconstructionCache(account: string | undefined, key?: string): ReconstructionCache | null {
  try {
    const entries: unknown = JSON.parse(localStorage.getItem(reconstructionStorageKey(account)) ?? '[]');
    if (!Array.isArray(entries)) return null;
    return entries.find(v => v?.version === 1 && typeof v.key === 'string' && (!key || v.key === key)
      && Number.isFinite(v.result?.createdAt) && Array.isArray(v.result?.algorithms)) ?? null;
  } catch { return null; }
}
export function saveReconstructionCache(account: string | undefined, key: string, result: FishReconstructionResult): boolean {
  const entry: ReconstructionCache = { version: 1, key, result };
  // Keep the latest result plus one previous setting for an explicit, useful stale state.
  const previous = readReconstructionCache(account);
  const entries = previous && previous.key !== key ? [entry, previous] : [entry];
  try { localStorage.setItem(reconstructionStorageKey(account), JSON.stringify(entries)); return true; }
  catch {
    try { localStorage.setItem(reconstructionStorageKey(account), JSON.stringify([entry])); return true; }
    catch { return false; }
  }
}
