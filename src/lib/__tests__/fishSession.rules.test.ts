import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { STATE_DEF } from '@/lib/deepDig/features';
import { compileFishProgram } from '@/lib/fish/algorithm';
import { loadFishSession, saveFishSession, type FishSession } from '@/lib/fish/session';
import { initialFishProgress } from '@/lib/fishScanner';
import type { FishWickRejection } from '@/lib/fish/downwardWick';

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

it('round conclusions and progress retain frozen wick evidence after durable reload',async()=>{
 const saved=session('结果'),wick:FishWickRejection={symbol:'WICKUSDT',exchange:'binance',openTime:300000,open:100,high:101,low:91,close:92,drop:9,atr:2,cutoffMs:900000,rule:{enabled:true,hours:48,atrMultiple:3},candles:[{openTime:300000,open:100,high:101,low:91,close:92}]};
 saved.data.results.set('binance|crypto|WICKUSDT',new Map([[0,{outcome:'wick',wick}]]));
 saved.progress={...initialFishProgress(),status:'complete',wickSkipped:1,wickDetails:[wick]};
 await saveFishSession('wick',saved);const loaded=await loadFishSession('wick');
 expect(loaded?.progress?.wickDetails).toEqual([wick]);
 expect(loaded?.data.results.get('binance|crypto|WICKUSDT')?.get(0)?.wick).toEqual(wick);
 wick.rule.atrMultiple=1;expect(loaded?.progress?.wickDetails?.[0].rule.atrMultiple).toBe(3);
});
