/**
 * getVisibleData（正放视图）的幕规则：可见 = time <= simTime，部分蜡烛按 bar 内进度插值。
 * 时钟被移到更早时刻时可见集合收缩、当前蜡烛缩回开盘——这是正放幕的自洽性。
 * （倒叙播放使用独立的镜像视图，见 lib/reversePlayback 及其测试。）
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBinanceData, type KlineData } from '@/hooks/useBinanceData';

const MIN = 60_000;
// 三根 1m 蜡烛：开盘价 100/110/120，收盘价 110/120/130（远离 Date.now 判定的 isLiveCandle）
const BASE = 1_600_000_000_000;
const CANDLES: KlineData[] = [
  { time: BASE + 0 * MIN, open: 100, high: 112, low: 99, close: 110, volume: 10 },
  { time: BASE + 1 * MIN, open: 110, high: 122, low: 109, close: 120, volume: 10 },
  { time: BASE + 2 * MIN, open: 120, high: 132, low: 119, close: 130, volume: 10 },
];

function mockFetchAll() {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => CANDLES.map(c => [c.time, String(c.open), String(c.high), String(c.low), String(c.close), String(c.volume)]),
  })) as unknown as typeof fetch);
}

describe('getVisibleData 在时钟倒退时', () => {
  beforeEach(() => {
    mockFetchAll();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('可见集合收缩、当前蜡烛按进度从收盘缩回开盘', async () => {
    const { result } = renderHook(() => useBinanceData());
    await act(async () => {
      await result.current.initLoad('TESTUSDT', '1m', BASE + 3 * MIN);
    });

    // 正放位置：时钟在第 3 根的一半 → 3 根可见，最后一根为半成形
    const forward = result.current.getVisibleData(BASE + 2 * MIN + MIN / 2, MIN);
    expect(forward).toHaveLength(3);
    expect(forward[2].close).toBeCloseTo(120 + (130 - 120) * 0.5, 10);

    // 时钟倒退到第 2 根的 1/4 → 只剩 2 根，第二根缩回到 open + 25% 的位置
    const reversed = result.current.getVisibleData(BASE + 1 * MIN + MIN / 4, MIN);
    expect(reversed).toHaveLength(2);
    expect(reversed[1].open).toBe(110);
    expect(reversed[1].close).toBeCloseTo(110 + (120 - 110) * 0.25, 10);
    // 第一根已完整落定，不受影响
    expect(reversed[0]).toMatchObject({ open: 100, close: 110 });

    // 继续倒退到第 1 根开盘之前 → 什么都不可见（主观未来被遮蔽）
    expect(result.current.getVisibleData(BASE - 1, MIN)).toHaveLength(0);
  });

  it('倒退到蜡烛开盘瞬间时进度为 0，蜡烛几乎退化为开盘价一点', async () => {
    const { result } = renderHook(() => useBinanceData());
    await act(async () => {
      await result.current.initLoad('TESTUSDT', '1m', BASE + 3 * MIN);
    });

    const atOpen = result.current.getVisibleData(BASE + 1 * MIN, MIN);
    expect(atOpen).toHaveLength(2);
    expect(atOpen[1].close).toBe(110);
    expect(atOpen[1].high).toBe(110);
    expect(atOpen[1].low).toBe(110);
  });
});
