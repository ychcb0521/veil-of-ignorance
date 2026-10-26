// 持续挖掘的调度：一档接一档补历史；取数器忙时等待；被捕捞打断原地重扫；出错重试；到目标就停
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useFishMining } from '@/hooks/useFishMining';
import { MINING_START_MS, MINING_STEP_MS, readMiningState } from '@/lib/fish/mining';
import { BUILTIN_FEATURES } from '@/lib/deepDig/features';
import { fishFeatureDefinitions } from '@/lib/fish/features';
import type { TradeSignal } from '@/lib/signalLibrary';

const defs = fishFeatureDefinitions(BUILTIN_FEATURES), selection = { exchanges: ['binance' as const], includeDuplicates: false };
const sig = (symbol: string, t: number): TradeSignal => ({ id: `${symbol}-${t}`, symbol, timeMs: t - 600_000, timeLabel: '', fallbackZone: '', freshCatch: true,
  fish: { featureId: 'cbi2', featureShort: 'CBI-2', statistic: '结果', cutoffMs: t, threshold: .04, direction: '>', average: .1, cbi2: .1, startAverage: .1, previousAverage: 0, scale: 1 } as never });
beforeEach(() => { localStorage.clear(); vi.useFakeTimers({ shouldAdvanceTime: false }); vi.setSystemTime(MINING_START_MS + 2 * MINING_STEP_MS + 1000); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
const flush = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
function setup(o: { mine?: (s: any) => Promise<TradeSignal[]>; busy?: () => boolean } = {}) {
  const list = { current: [] as TradeSignal[] }, commit = vi.fn((next: TradeSignal[]) => { list.current = next; }), onMined = vi.fn(), stop = vi.fn();
  const mine = vi.fn(o.mine ?? (async (s: any) => [sig(`A${s.anchorMs}USDT`, s.anchorMs)]));
  const h = renderHook(() => useFishMining({ account: 'a', selection, defs, mine, busy: o.busy ?? (() => false), stop, signalsRef: list, commit, onMined }));
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
