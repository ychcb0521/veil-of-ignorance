import { describe, expect, it } from 'vitest';
import { matchDatasetKey, planMatchBatch, type MatchCursor } from '@/lib/matchingWindow';

const MIN = 60_000;
const T0 = Date.parse('2026-01-01T00:00:00Z');
const bars = (count: number, from = T0, step = MIN) =>
  Array.from({ length: count }, (_, i) => ({ time: from + i * step, tag: i }));

const KEY = matchDatasetKey('BTCUSDT', MIN, 1);

describe('撮合窗口：哪几根算「新收盘」', () => {
  it('【回归】首批数据不撮合任何一根——刷新页面时这里曾把上千根历史当新 K 线喂进去', () => {
    const candles = bars(1000);
    const plan = planMatchBatch({ cursor: null, key: KEY, candles, direction: 1 });
    expect(plan.match).toHaveLength(0);
    expect(plan.seededReason).toBe('first-load');
    expect(plan.nextCursor.lastCandleTime).toBe(candles[999].time);
  });

  it('【回归】换标的 / 换周期 / 换方向同样只重设水位，不回放历史', () => {
    const cursor: MatchCursor = { key: KEY, lastCandleTime: T0 + 10 * MIN };
    for (const otherKey of [
      matchDatasetKey('ETHUSDT', MIN, 1),
      matchDatasetKey('BTCUSDT', 5 * MIN, 1),
      matchDatasetKey('BTCUSDT', MIN, -1),
    ]) {
      const plan = planMatchBatch({ cursor, key: otherKey, candles: bars(500), direction: 1 });
      expect(plan.match).toHaveLength(0);
      expect(plan.seededReason).toBe('dataset-changed');
      expect(plan.nextCursor.key).toBe(otherKey);
    }
  });

  it('正常推进：只喂时间大于水位的那几根，按时间升序', () => {
    const cursor: MatchCursor = { key: KEY, lastCandleTime: T0 + 2 * MIN };
    const plan = planMatchBatch({ cursor, key: KEY, candles: bars(6), direction: 1 });
    expect(plan.match.map(c => c.time)).toEqual([3, 4, 5].map(i => T0 + i * MIN));
    expect(plan.nextCursor.lastCandleTime).toBe(T0 + 5 * MIN);
  });

  it('【回归】往前面补更早的历史（loadOlder）不会被当成新 K 线', () => {
    // 数组变长了，但新增的是**更早**的根：长度差的写法会去撮合末尾那几根。
    const cursor: MatchCursor = { key: KEY, lastCandleTime: T0 + 5 * MIN };
    const older = bars(3, T0 - 3 * MIN);
    const candles = [...older, ...bars(6)];
    const plan = planMatchBatch({ cursor, key: KEY, candles, direction: 1 });
    expect(plan.match).toHaveLength(0);
    expect(plan.nextCursor.lastCandleTime).toBe(T0 + 5 * MIN);
  });

  it('倒放：新露头的是**更早**的根，按时间降序喂', () => {
    const revKey = matchDatasetKey('BTCUSDT', MIN, -1);
    const cursor: MatchCursor = { key: revKey, lastCandleTime: T0 + 3 * MIN };
    const plan = planMatchBatch({ cursor, key: revKey, candles: bars(6), direction: -1 });
    expect(plan.match.map(c => c.time)).toEqual([2, 1, 0].map(i => T0 + i * MIN));
    expect(plan.nextCursor.lastCandleTime).toBe(T0);
  });

  it('没有新根时水位不动，重复调用不会重复撮合', () => {
    const cursor: MatchCursor = { key: KEY, lastCandleTime: T0 + 5 * MIN };
    const candles = bars(6);
    const first = planMatchBatch({ cursor, key: KEY, candles, direction: 1 });
    expect(first.match).toHaveLength(0);
    const second = planMatchBatch({ cursor: first.nextCursor, key: KEY, candles, direction: 1 });
    expect(second.match).toHaveLength(0);
    expect(second.nextCursor.lastCandleTime).toBe(cursor.lastCandleTime);
  });

  it('连续两批不重不漏', () => {
    let cursor = planMatchBatch({ cursor: null, key: KEY, candles: bars(3), direction: 1 }).nextCursor;
    const a = planMatchBatch({ cursor, key: KEY, candles: bars(5), direction: 1 });
    cursor = a.nextCursor;
    const b = planMatchBatch({ cursor, key: KEY, candles: bars(7), direction: 1 });
    expect(a.match.map(c => c.tag)).toEqual([3, 4]);
    expect(b.match.map(c => c.tag)).toEqual([5, 6]);
  });

  it('空数据与 NaN 时刻都不产生撮合', () => {
    expect(planMatchBatch({ cursor: null, key: KEY, candles: [], direction: 1 }).match).toHaveLength(0);
    const cursor: MatchCursor = { key: KEY, lastCandleTime: T0 };
    const dirty = [{ time: Number.NaN }, { time: T0 + MIN }];
    const plan = planMatchBatch({ cursor, key: KEY, candles: dirty, direction: 1 });
    expect(plan.match.map(c => c.time)).toEqual([T0 + MIN]);
  });
});
