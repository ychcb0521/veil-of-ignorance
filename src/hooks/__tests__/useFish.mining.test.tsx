// 持续挖掘让路：挖掘不算「忙」（定时捕捞不用等），一开始捕捞就打断这一档、等取数器空出来再捕
import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('@/lib/simStateSync', () => ({ queueSimStatePush: vi.fn() }));
vi.mock('@/lib/fish/session', () => ({ saveFishSession: vi.fn(async () => {}), loadFishSession: vi.fn(async () => null) }));
const calls = vi.hoisted(() => [] as { anchorMs?: number; aborted: () => boolean }[]);
vi.mock('@/lib/fishScanner', async original => {
  const real = await original<typeof import('@/lib/fishScanner')>();
  class FakeScanner {
    running = false;
    isBusy() { return this.running; }
    async scan(o: any) {
      if (this.running) throw new Error('扫描正在进行');
      this.running = true; calls.push({ anchorMs: o.anchorMs, aborted: () => o.signal.aborted });
      try {
        await new Promise<void>(resolve => { const t = setTimeout(resolve, o.anchorMs ? 10_000 : 10); o.signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }); });
        if (!o.signal.aborted) o.onSignal({ id: 'x', symbol: 'XUSDT', timeMs: 1, timeLabel: '', fallbackZone: '', fish: { cutoffMs: 2, threshold: 1, average: 1, cbi2: 1, startAverage: 1, previousAverage: 0 } });
        return { ...real.initialFishProgress(), status: o.signal.aborted ? 'aborted' : 'complete' };
      } finally { this.running = false; }
    }
  }
  return { ...real, FishScanner: FakeScanner };
});
const { useFish } = await import('@/hooks/useFish');
beforeEach(() => { localStorage.clear(); calls.length = 0; vi.useRealTimers(); });

it('mines without counting as busy, yields to a capture, and the capture runs once the fetcher is free', async () => {
  const { result } = renderHook(() => useFish(undefined));
  let mined: Promise<unknown> | undefined;
  act(() => { mined = result.current.mine({ anchorMs: 123 }); mined.catch(() => {}); });
  await act(async () => { await Promise.resolve(); });
  expect(result.current.busy()).toBe(false); // 定时捕捞不用等挖掘
  await act(async () => { await result.current.start({}); });
  await expect(mined).rejects.toMatchObject({ name: 'AbortError' });
  expect(calls.map(c => c.anchorMs)).toEqual([123, undefined]); // 先打断挖掘，再捕
  expect(calls[0].aborted()).toBe(true);
  expect(result.current.signals.some(s => s.symbol === 'XUSDT' && s.freshCatch)).toBe(true); // 捕捞结果照常进新鱼
});
it('returns the anchor hits without touching the fish list, and refuses to start while a capture is running', async () => {
  const { result } = renderHook(() => useFish(undefined));
  vi.useFakeTimers();
  let found: unknown;
  await act(async () => { const p = result.current.mine({ anchorMs: 456 }); await vi.advanceTimersByTimeAsync(10_000); found = await p; });
  expect(found).toEqual([expect.objectContaining({ symbol: 'XUSDT' })]);
  expect(result.current.signals).toHaveLength(0);
  let capture: Promise<void> | undefined;
  act(() => { capture = result.current.start({}); });
  await expect(result.current.mine({ anchorMs: 789 })).rejects.toThrow('取数器正忙');
  await act(async () => { await vi.advanceTimersByTimeAsync(20); await capture; });
});
