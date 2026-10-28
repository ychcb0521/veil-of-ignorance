import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { STATE_DEF } from '@/lib/deepDig/features';
import { compileFishProgram } from '@/lib/fish/algorithm';
import { loadFishSession, saveFishSession, type FishSession } from '@/lib/fish/session';

const rows = new Map<string, unknown>(), key = (k: unknown) => JSON.stringify(k);
beforeEach(() => {
  rows.clear();
  const database = {
    close: () => {}, createObjectStore: () => {}, transaction: () => {
      const tx: { oncomplete?: () => void; objectStore?: () => object } = {};
      tx.objectStore = () => ({
        get: (k: unknown) => { const r: { result?: unknown; onsuccess?: () => void } = {}; queueMicrotask(() => { r.result = structuredClone(rows.get(key(k))); r.onsuccess?.(); }); return r; },
        put: (v: unknown, k: unknown) => { rows.set(key(k), structuredClone(v)); queueMicrotask(() => tx.oncomplete?.()); },
        delete: (k: unknown) => { rows.delete(key(k)); queueMicrotask(() => tx.oncomplete?.()); },
      }); return tx;
    },
  };
  vi.stubGlobal('indexedDB', { open: () => { const r: { result?: unknown; onsuccess?: () => void } = {}; queueMicrotask(() => { r.result = database; r.onsuccess?.(); }); return r; } });
});
afterEach(() => vi.unstubAllGlobals());
const plan = (statistic = 'state') => compileFishProgram({ ...STATE_DEF, formula: 'state = C\navg_state_2 = avg(state,24)' }, { statistic, direction: '>', threshold: 0.7, constraints: [] });
const session = (statistic?: string): FishSession => ({
  mode: 'and', keys: [], added: [], refreshed: [], edits: [], progress: null,
  data: { plans: [plan(statistic)], results: new Map(), complete: true, memberHits: [0], anchorMs: 1 },
});

it('restores a new scan with its admission-rule key and no rescan warning', async () => {
  await saveFishSession('new', session());
  const loaded = await loadFishSession('new');
  expect(loaded?.needsRescan).toBeUndefined();
  expect(loaded?.data.plans[0].stateHold).toEqual({ threshold: 0.55, hours: 6, samples: 73 });
});

it('marks legacy raw-S conclusions stale rather than attaching the new rule to old results', async () => {
  await saveFishSession('old', session());
  const stored = rows.get(key('old')) as { data: { plans: { algorithmKey?: string }[] } };
  delete stored.data.plans[0].algorithmKey;
  const before = structuredClone(stored);
  expect((await loadFishSession('old'))?.needsRescan).toContain('请重新捕捞');
  expect(rows.get(key('old'))).toEqual(before);
});

it('also rejects an explicit rule-key mismatch, while keeping legacy average scans usable', async () => {
  await saveFishSession('changed', session());
  const stored = rows.get(key('changed')) as { data: { plans: { algorithmKey?: string }[] } };
  stored.data.plans[0].algorithmKey = 'old-rule';
  expect((await loadFishSession('changed'))?.needsRescan).toBeDefined();
  await saveFishSession('average', session('avg_state_2'));
  const average = rows.get(key('average')) as { data: { plans: { algorithmKey?: string }[] } };
  delete average.data.plans[0].algorithmKey;
  expect((await loadFishSession('average'))?.needsRescan).toBeUndefined();
});

it('restores the exact frozen coverage window and extended history after refresh',async()=>{
 const saved=session('结果');saved.data.lookbackHours=72;
 await saveFishSession('window',saved);const loaded=await loadFishSession('window');
 expect(loaded?.data.lookbackHours).toBe(72);expect(loaded?.needsRescan).toBeUndefined();expect(loaded!.data.plans[0].N).toBeGreaterThanOrEqual(saved.data.plans[0].N);
});
