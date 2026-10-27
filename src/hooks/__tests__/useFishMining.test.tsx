// 持续挖掘的调度：一档接一档补历史；取数器忙时等待；被捕捞打断原地重扫；出错重试；到目标就停
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useFishMining } from '@/hooks/useFishMining';
import { MINING_START_MS, MINING_STEP_MS, MINING_STALL_MS, saveMiningState, newMiningState, readMiningState } from '@/lib/fish/mining';
import { BUILTIN_FEATURES } from '@/lib/deepDig/features';
import { fishFeatureDefinitions } from '@/lib/fish/features';
import type { TradeSignal } from '@/lib/signalLibrary';

const defs = fishFeatureDefinitions(BUILTIN_FEATURES), selection = { exchanges: ['binance' as const], includeDuplicates: false };
const sig = (symbol: string, t: number): TradeSignal => ({ id: `${symbol}-${t}`, symbol, timeMs: t - 600_000, timeLabel: '', fallbackZone: '', freshCatch: true,
  fish: { featureId: 'cbi2', featureShort: 'CBI-2', statistic: '结果', cutoffMs: t, threshold: .04, direction: '>', average: .1, cbi2: .1, startAverage: .1, previousAverage: 0, scale: 1 } as never });
beforeEach(() => { localStorage.clear(); vi.useFakeTimers({ shouldAdvanceTime: false }); vi.setSystemTime(MINING_START_MS + 2 * MINING_STEP_MS + 1000); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
const flush = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
function setup(o: { mine?: (s: any) => Promise<TradeSignal[]>; busy?: () => boolean; definitions?: typeof defs } = {}) {
  const list = { current: [] as TradeSignal[] }, commit = vi.fn((next: TradeSignal[]) => { list.current = next; }), onMined = vi.fn(), stop = vi.fn();
  const mine = vi.fn(o.mine ?? (async (s: any) => [sig(`A${s.anchorMs}USDT`, s.anchorMs)]));
  const h = renderHook(() => useFishMining({ account: 'a', selection, defs:o.definitions??defs, mine, busy: o.busy ?? (() => false), stop, signalsRef: list, commit, onMined }));
  return { h, mine, commit, list, onMined, stop };
}

it('does nothing until started, then backfills anchor after anchor with the frozen default algorithms (union)', async () => {
  const { h, mine, list, onMined } = setup();
  await flush(); expect(mine).not.toHaveBeenCalled();
  act(() => h.result.current.start()); await flush(10);
  expect(mine.mock.calls.map(c => c[0].anchorMs)).toEqual([MINING_START_MS, MINING_START_MS + MINING_STEP_MS, MINING_START_MS + 2 * MINING_STEP_MS]);
  expect(mine.mock.calls[0][0]).toMatchObject({ combination: 'or' });
  expect(mine.mock.calls[0][0].algorithms.map((a: any) => a.feature.id)).toEqual(['cbi2', 'state', 'cba', 'drift-speed-z', 'bss']);
  expect(list.current).toHaveLength(3); expect(list.current.every(s => s.mined && !s.freshCatch)).toBe(true);
  expect(onMined).toHaveBeenCalledTimes(3);
  expect(readMiningState()).toMatchObject({ mined: 3, anchorsDone: 3, cursorMs: MINING_START_MS + 3 * MINING_STEP_MS });
  // 追上现在：下一档到点才挖
  await flush(30_000); expect(mine).toHaveBeenCalledTimes(3);
  vi.setSystemTime(MINING_START_MS + 3 * MINING_STEP_MS); await flush(30_000); expect(mine).toHaveBeenCalledTimes(4);
});
it('stops at the target and resumes when the target is raised', async () => {
  const { h, mine } = setup();
  act(() => h.result.current.setTarget(2)); act(() => h.result.current.start()); await flush(10);
  expect(mine).toHaveBeenCalledTimes(2); expect(readMiningState().mined).toBe(2);
  act(() => h.result.current.setTarget(3)); await flush(10); expect(mine).toHaveBeenCalledTimes(3);
});
it('waits while the fetcher is busy, rescans the same anchor after yielding, and retries errors two minutes later', async () => {
  let busy = true, attempt = 0;
  const { h, mine } = setup({ busy: () => busy, mine: async (s: any) => {
    attempt++;
    if (attempt === 1) throw new DOMException('已让路给捕捞', 'AbortError');
    if (attempt === 2) throw new Error('网络中断');
    return [sig('XUSDT', s.anchorMs)];
  } });
  act(() => h.result.current.start()); await flush(10);
  expect(mine).not.toHaveBeenCalled(); expect(h.result.current.waiting).toContain('取数器正忙');
  busy = false; await flush(30_000);
  expect(mine).toHaveBeenCalledTimes(1); expect(readMiningState().cursorMs).toBe(MINING_START_MS); // 让路：不前进
  await flush(30_000);
  expect(mine).toHaveBeenCalledTimes(2); // 下一次巡检原地重扫，这次出错
  expect(mine.mock.calls[1][0].anchorMs).toBe(MINING_START_MS);
  expect(readMiningState()).toMatchObject({ cursorMs: MINING_START_MS, lastError: '网络中断' });
  await flush(60_000); expect(mine).toHaveBeenCalledTimes(2); // 2 分钟内不重试
  await flush(90_000); expect(mine.mock.calls[2][0].anchorMs).toBe(MINING_START_MS);
  expect(readMiningState().lastError).toBe('');
});
it('pause stops the running anchor and keeps the cursor', async () => {
  let release: (v: TradeSignal[]) => void = () => {};
  const { h, stop } = setup({ mine: () => new Promise(r => { release = r; }) });
  act(() => h.result.current.start()); await flush(10);
  expect(h.result.current.running).toBe(true);
  act(() => h.result.current.pause()); expect(stop).toHaveBeenCalled();
  release([sig('LATEUSDT', MINING_START_MS)]); await flush(10);
  expect(readMiningState()).toMatchObject({ enabled: false, cursorMs: MINING_START_MS, mined: 0 }); // 暂停后不收这一档
});
// 【用户要求】2026-10-26 下次点开时按时间顺序接上：进度丢了（或被旧快照盖回去）也从鱼舱里最后挖到的那一档往后挖
it('resumes after the last mined anchor found in the cabin even when the saved progress was lost', async () => {
  const first = setup();
  act(() => first.h.result.current.start()); await flush(10);
  expect(first.mine).toHaveBeenCalledTimes(3);
  const cabin = first.list.current;
  first.h.unmount();
  // 模拟进度被盖回最初的快照：开着，但游标回到起点
  const key = Object.keys(localStorage).find(k => k.endsWith('fish-mining.v1'))!;
  localStorage.setItem(key, JSON.stringify({ ...JSON.parse(localStorage.getItem(key)!), cursorMs: MINING_START_MS, anchorsDone: 0, mined: 0, minedKeys: [], lastAnchorMs: null }));
  vi.setSystemTime(MINING_START_MS + 3 * MINING_STEP_MS);
  const list = { current: cabin }, mine = vi.fn(async (s: any) => [sig(`B${s.anchorMs}USDT`, s.anchorMs)]);
  const h = renderHook(() => useFishMining({ account: 'a', selection, defs, mine, busy: () => false, stop: vi.fn(), signalsRef: list, commit: (next: TradeSignal[]) => { list.current = next; } }));
  expect(h.result.current.state).toMatchObject({ cursorMs: MINING_START_MS + 3 * MINING_STEP_MS, anchorsDone: 3, mined: 3 });
  await flush(10);
  expect(mine.mock.calls.map(c => c[0].anchorMs)).toEqual([MINING_START_MS + 3 * MINING_STEP_MS]);
  expect(readMiningState()).toMatchObject({ cursorMs: MINING_START_MS + 4 * MINING_STEP_MS, anchorsDone: 4, mined: 4 });
});

it('holds configuration errors for user repair instead of retrying forever, then retries after the definition is restored',async()=>{
 const available:typeof defs=[];
 saveMiningState({...newMiningState(),enabled:true,rules:[{id:'first',featureId:'cbi2',statistic:'结果',threshold:'0.04'}]});
 const {h,mine}=setup({definitions:available});await flush(10);
 expect(h.result.current.state).toMatchObject({errorKind:'configuration',retryAt:null,cursorMs:MINING_START_MS});
 await flush(10*60_000);expect(mine).not.toHaveBeenCalled();
 available.push(defs.find(d=>d.id==='cbi2')!);act(()=>h.result.current.retry!());await flush(10);
 expect(mine).toHaveBeenCalled();expect(h.result.current.state.lastError).toBe('');
});
it('persists cooldown across refresh, backs repeated failures off, and supports immediate manual retry without resetting the cursor',async()=>{
 const first=setup({mine:async()=>{throw new Error('网络中断');}});act(()=>first.h.result.current.start());await flush(10);
 const due=readMiningState().retryAt!;expect(due-Date.now()).toBeGreaterThan(119000);first.h.unmount();
 let okay=false;const next=setup({mine:async s=>{if(!okay)throw new Error('网络中断');return [sig('RECOVERUSDT',s.anchorMs)];}});
 await flush(60_000);expect(next.mine).not.toHaveBeenCalled();await flush(90_000);
 expect(next.mine).toHaveBeenCalledTimes(1);expect(readMiningState().retryCount).toBe(2);expect(readMiningState().retryAt!-Date.now()).toBeGreaterThan(200000);
 okay=true;act(()=>next.h.result.current.retry!());await flush(10);
 expect(next.mine.mock.calls[1][0].anchorMs).toBe(MINING_START_MS);expect(readMiningState().lastError).toBe('');expect(readMiningState().retryCount).toBe(0);
});
it('stops a stalled anchor and ignores its late result, retaining the same cursor for retry',async()=>{
 let release!:(v:TradeSignal[])=>void;const {h,stop,commit}=setup({mine:()=>new Promise(r=>{release=r;})});
 act(()=>h.result.current.start());await flush(10);await flush(MINING_STALL_MS);
 expect(stop).toHaveBeenCalled();expect(h.result.current.running).toBe(false);expect(readMiningState()).toMatchObject({cursorMs:MINING_START_MS,errorKind:'transient'});expect(readMiningState().lastError).toContain('5 分钟');
 release([sig('LATEUSDT',MINING_START_MS)]);await flush(10);expect(commit).not.toHaveBeenCalled();
});
it('waits offline without reporting a scan failure and resumes when the browser comes online',async()=>{
 const online=vi.spyOn(navigator,'onLine','get').mockReturnValue(false),{h,mine}=setup();
 act(()=>h.result.current.start());await flush(10);expect(mine).not.toHaveBeenCalled();expect(h.result.current.waiting).toContain('网络已断开');
 online.mockReturnValue(true);act(()=>window.dispatchEvent(new Event('online')));await flush(10);expect(mine).toHaveBeenCalled();expect(readMiningState().lastError).toBe('');
});
it('rejects an old account failure after switching accounts',async()=>{
 const rejects:((e:Error)=>void)[]=[],list={current:[] as TradeSignal[]},mine=vi.fn(()=>new Promise<TradeSignal[]>((_,reject)=>rejects.push(reject)));
 const h=renderHook(({account})=>useFishMining({account,selection,defs,mine,busy:()=>false,stop:vi.fn(),signalsRef:list,commit:vi.fn()}),{initialProps:{account:'a'}});
 act(()=>h.result.current.start());await flush(10);h.rerender({account:'b'});await flush(10);
 rejects[0](new Error('旧账号失败'));await flush(10);expect(h.result.current.state.lastError).toBe('');expect(readMiningState().lastError).toBe('');
});

it('recovers invalid saved settings with defaults without erasing already-mined progress',async()=>{
 saveMiningState({...newMiningState(),enabled:true,cursorMs:MINING_START_MS+MINING_STEP_MS,anchorsDone:1,mined:220,rules:[{id:'bad',featureId:'cbi2',statistic:'missing',threshold:'bad'}]});
 const {h,mine}=setup();await flush(10);expect(h.result.current.state.errorKind).toBe('configuration');
 act(()=>h.result.current.resetConfiguration!());await flush(10);
 expect(mine).toHaveBeenCalled();expect(mine.mock.calls[0][0].anchorMs).toBe(MINING_START_MS+MINING_STEP_MS);expect(readMiningState().mined).toBeGreaterThanOrEqual(220);expect(readMiningState().anchorsDone).toBeGreaterThanOrEqual(1);
});
it('pauses immediately even when a request ignores abort, and never accepts its late result',async()=>{
 let release!:(value:TradeSignal[])=>void;const {h,commit}=setup({mine:()=>new Promise(resolve=>{release=resolve;})});
 act(()=>h.result.current.start());await flush(10);act(()=>h.result.current.pause());await flush(10);
 expect(h.result.current.running).toBe(false);release([sig('LATEUSDT',MINING_START_MS)]);await flush(10);expect(commit).not.toHaveBeenCalled();expect(readMiningState().cursorMs).toBe(MINING_START_MS);
});

it('treats an unsupported frozen venue as a configuration problem and repairs only the scope on request',async()=>{
 saveMiningState({...newMiningState(),enabled:true,rules:[{id:'first',featureId:'cbi2',statistic:'结果',threshold:'.04'}],selection:{exchanges:['bybit'],includeDuplicates:false}});
 const {h,mine}=setup();await flush(10);expect(mine).not.toHaveBeenCalled();expect(readMiningState().errorKind).toBe('configuration');
 act(()=>h.result.current.useCurrentScope!());await flush(10);expect(mine).toHaveBeenCalled();expect(readMiningState().selection?.exchanges).toEqual(['binance']);
});
