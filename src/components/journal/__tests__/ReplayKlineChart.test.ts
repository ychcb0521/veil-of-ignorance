import { describe, expect, it } from 'vitest';
import type { KlineData } from '@/hooks/useBinanceData';
import { findReplayCursorIndex, sliceReplayKlines } from '@/lib/replayKlineWindow';

function candle(time: number): KlineData {
  return {
    time,
    open: time,
    high: time + 1,
    low: time - 1,
    close: time,
    volume: 1,
  };
}

describe('ReplayKlineChart windowing', () => {
  const klines = Array.from({ length: 20 }, (_, index) => candle(index));

  it('没有 viewportCenterTime 时沿用当前时刻向前回看', () => {
    const sliced = sliceReplayKlines(klines, 10, 4);
    expect(sliced.map(item => item.time)).toEqual([7, 8, 9, 10]);
  });

  it('有 viewportCenterTime 时围绕中心锚点裁剪，而不是挤到最新 K 线', () => {
    const sliced = sliceReplayKlines(klines, 19, 6, 10);
    expect(sliced.map(item => item.time)).toEqual([7, 8, 9, 10, 11, 12]);
  });

  it('中心锚点靠近边界时会稳定夹取，不产生空窗口', () => {
    expect(sliceReplayKlines(klines, 19, 6, 1).map(item => item.time)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(sliceReplayKlines(klines, 19, 6, 18).map(item => item.time)).toEqual([14, 15, 16, 17, 18, 19]);
  });

  it('二分游标选择不超过目标时间的最后一根 K 线', () => {
    expect(findReplayCursorIndex(klines, 10.5)).toBe(10);
    expect(findReplayCursorIndex(klines, -1)).toBe(-1);
  });
});
