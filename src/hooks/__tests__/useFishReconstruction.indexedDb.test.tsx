// 【用户要求】2026-10-20「复原扫描的这个结果能保存吗？」——localStorage 满了也要存得住、刷新后还在
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useFishFeatures } from '@/hooks/useFishFeatures';
import { useFishReconstruction } from '@/hooks/useFishReconstruction';
import { CBI2_DEF } from '@/lib/deepDig/features';
import { loadReconstructionCacheDb, reconstructionStorageKey, saveReconstructionCache, saveReconstructionCacheDb, type ReconstructionCard } from '@/lib/fish/reconstructionCache';
import type { FishReconstructionResult } from '@/lib/fish/reconstruction';
import type { TradeSignal } from '@/lib/signalLibrary';
vi.mock('@/hooks/useFishFeatures', () => ({ useFishFeatures: vi.fn() }));
const def = { ...CBI2_DEF, id: 'reconstruction-ui', short: 'TEST', formula: 'avg_X = avg(C, 1)', scale: 1 };
const cards: ReconstructionCard[] = [{ id: 'first', featureId: def.id, enabled: true, pref: { statistic: '结果', direction: '>', threshold: '2', constraints: [] } }];
const signals: TradeSignal[] = [{ id: 'one', symbol: 'AAAUSDT', timeMs: Date.UTC(2026, 5, 20), timeLabel: '', fallbackZone: '' }];
const report = (createdAt = 1000) => ({ createdAt, fingerprint: 'f', algorithms: [{ label: 'BIG', perSignal: 'x'.repeat(1000) }] } as unknown as FishReconstructionResult);
/** 最小的 IndexedDB：一个库、一个对象仓库，异步回调，存取都做结构化拷贝。 */
function fakeIndexedDb() {
  const stores = new Map<string, Map<unknown, unknown>>();
  const later = (f: () => void) => setTimeout(f, 0);
  const db = {
    createObjectStore: (name: string) => { stores.set(name, new Map()); },
    close: () => {},
    transaction: (name: string) => {
      const store = stores.get(name)!, tx: any = {};
      tx.objectStore = () => ({
        get: (k: unknown) => { const r: any = {}; later(() => { r.result = structuredClone(store.get(k)); r.onsuccess?.(); }); return r; },
        put: (v: unknown, k: unknown) => { store.set(k, structuredClone(v)); later(() => tx.oncomplete?.()); },
      });
      return tx;
    },
  };
  return { open: () => { const r: any = {}; later(() => { r.result = db; if (!stores.size) r.onupgradeneeded?.(); r.onsuccess?.(); }); return r; } };
}
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); vi.mocked(useFishFeatures).mockReturnValue([def]);
  localStorage.setItem('sb-test-auth-token', JSON.stringify({ user: { id: 'account-a' } }));
  localStorage.setItem('sim_account-a_fish-cards.v1', JSON.stringify(cards));
  vi.stubGlobal('indexedDB', fakeIndexedDb());
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it('存进 IndexedDB 并删掉 localStorage 旧副本；保留上一套设置的一份',async()=>{
 saveReconstructionCache('account-a','old',report(1));
 expect(await saveReconstructionCacheDb('account-a','k1',report(2))).toBe(true);
 expect(localStorage.getItem(reconstructionStorageKey('account-a'))).toBeNull();
 expect((await loadReconstructionCacheDb('account-a','k1'))?.result.createdAt).toBe(2);
 expect((await loadReconstructionCacheDb('account-a','old'))?.result.createdAt).toBe(1);
 expect(await loadReconstructionCacheDb('account-b')).toBeNull();
});
it('localStorage 满了也能保存：不再提示空间不足，刷新（重新挂载）后结果还在',async()=>{
 const execute = vi.fn(async () => report());
 const hook = renderHook(() => useFishReconstruction('account-a', signals, execute));
 vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
 await act(async () => { await hook.result.current.start(); });
 expect(hook.result.current.warning).toBe('');expect(hook.result.current.result).toEqual(report());
 hook.unmount();
 const again = renderHook(() => useFishReconstruction('account-a', signals, execute));
 await waitFor(() => expect(again.result.current.result).toEqual(report()));
 expect(again.result.current.stale).toBe(false);
 await act(async () => { await again.result.current.start(); });
 expect(execute).toHaveBeenCalledTimes(1);
});
