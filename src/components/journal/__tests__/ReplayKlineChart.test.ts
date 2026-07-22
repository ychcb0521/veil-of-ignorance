import { describe, expect, it } from 'vitest';
import type { KlineData } from '@/hooks/useBinanceData';
import { findReplayCursorIndex, normalizeReplayKlines, sliceReplayKlines } from '@/lib/replayKlineWindow';

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

  it('历史分页 K 线会按时间升序、去重并清除无效数据', () => {
    const duplicate = { ...candle(2000), close: 9 };
    const invalid = { ...candle(4000), high: Number.NaN };
    const normalized = normalizeReplayKlines([
      candle(3000),
      candle(2000),
      candle(1000),
      duplicate,
      invalid,
    ]);

    expect(normalized.map(item => item.time)).toEqual([1000, 2000, 3000]);
    expect(normalized[1].close).toBe(9);
  });

  it('已经严格规范化的长历史 K 线复用原数组，避免重复全量复制', () => {
    const normalized = Array.from({ length: 15_000 }, (_, index) => candle(index * 60_000));

    expect(normalizeReplayKlines(normalized)).toBe(normalized);
  });
});
