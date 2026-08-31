import { describe, expect, it } from 'vitest';
import type { TradeSignal } from '@/lib/signalLibrary';
import {
  mergeSignals,
  sortSignalsBy,
  normalizeSignalQuality,
  setSignalQuality,
  SIGNAL_QUALITY_MAX,
} from '@/lib/signalLibrary';

const sig = (id: string, symbol: string, timeMs: number, over: Partial<TradeSignal> = {}): TradeSignal => ({
  id, symbol, timeMs, timeLabel: '2025-04-02 11:26', fallbackZone: '0.0046', ...over,
});

const LIST: TradeSignal[] = [
  sig('a', 'FUNUSDT', 1_000),
  sig('b', 'PLUMEUSDT', 2_000),
];

describe('信号质量评分', () => {
  it('打分写在信号自己身上，其余信号不受影响', () => {
    const next = setSignalQuality(LIST, 'a', 4);
    expect(next.find(s => s.id === 'a')?.quality).toBe(4);
    expect(next.find(s => s.id === 'b')?.quality).toBeUndefined();
    expect(LIST[0].quality).toBeUndefined();   // 原数组不动
  });

  it('【要求】最新评分覆盖旧的', () => {
    let list = setSignalQuality(LIST, 'a', 2);
    list = setSignalQuality(list, 'a', 5);
    expect(list.find(s => s.id === 'a')?.quality).toBe(5);
  });

  it('点当前星数 = 取消评分——否则误点之后只能删掉整条信号', () => {
    let list = setSignalQuality(LIST, 'a', 3);
    list = setSignalQuality(list, 'a', 3);
    expect(list.find(s => s.id === 'a')?.quality).toBeUndefined();
    expect('quality' in (list.find(s => s.id === 'a') as object)).toBe(false);
  });

  it('越界与脏值一律视为未评分，不写进去', () => {
    for (const bad of [0, -1, 6, NaN, Infinity, undefined, 'x' as unknown as number]) {
      expect(normalizeSignalQuality(bad)).toBeUndefined();
    }
    expect(normalizeSignalQuality(3.4)).toBe(3);
    expect(normalizeSignalQuality(SIGNAL_QUALITY_MAX)).toBe(5);
    expect(setSignalQuality(LIST, 'a', 9).find(s => s.id === 'a')?.quality).toBeUndefined();
  });

  it('id 不存在时原样返回同一个数组引用，不做无谓的重渲染', () => {
    expect(setSignalQuality(LIST, 'nope', 4)).toBe(LIST);
    // 同值重复设置也不产生新数组
    const rated = setSignalQuality(LIST, 'a', 4);
    expect(setSignalQuality(rated, 'b', undefined)).toBe(rated);
  });

  it('【回归】重新粘贴同一批信号不得冲掉已有评分', () => {
    // mergeSignals 按「标的@时间」去重并保留已存在的那条——
    // 评分存在信号对象上，所以这条性质正是评分能活下来的原因。
    const rated = setSignalQuality(LIST, 'a', 5);
    const reimported = [
      sig('new-a', 'FUNUSDT', 1_000),          // 同标的同时间，新 id
      sig('new-c', 'GRASSUSDT', 3_000),        // 真正的新信号
    ];
    const merged = mergeSignals(rated, reimported);
    expect(merged.find(s => s.symbol === 'FUNUSDT')?.quality).toBe(5);
    expect(merged.find(s => s.symbol === 'FUNUSDT')?.id).toBe('a');   // 保留旧那条
    expect(merged).toHaveLength(3);
  });
});

describe('按列排序', () => {
  const list: TradeSignal[] = [
    sig('a', 'FUNUSDT', 3_000, { quality: 2 }),
    sig('b', 'ALPHAUSDT', 1_000, { quality: 5 }),
    sig('c', 'ZETAUSDT', 2_000),            // 未评分
    sig('d', 'MIDUSDT', 4_000, { quality: 5 }),
  ];

  it('标的列按字母序，再点反向', () => {
    expect(sortSignalsBy(list, 'symbol', 'asc').map(s => s.symbol))
      .toEqual(['ALPHAUSDT', 'FUNUSDT', 'MIDUSDT', 'ZETAUSDT']);
    expect(sortSignalsBy(list, 'symbol', 'desc').map(s => s.symbol))
      .toEqual(['ZETAUSDT', 'MIDUSDT', 'FUNUSDT', 'ALPHAUSDT']);
  });

  it('时间列按时间序', () => {
    expect(sortSignalsBy(list, 'time', 'asc').map(s => s.timeMs)).toEqual([1_000, 2_000, 3_000, 4_000]);
    expect(sortSignalsBy(list, 'time', 'desc').map(s => s.timeMs)).toEqual([4_000, 3_000, 2_000, 1_000]);
  });

  it('评分列：高分优先，同分按时间新→旧', () => {
    expect(sortSignalsBy(list, 'quality', 'desc').map(s => s.id)).toEqual(['d', 'b', 'a', 'c']);
  });

  it('【要求】未评分永远沉底，升序也不例外', () => {
    // 未评分不是「0 星」。当成 0 会让升序时一堆还没看过的信号占满前排，
    // 而这一列的用途恰恰是「把我认可的挑出来」。
    const asc = sortSignalsBy(list, 'quality', 'asc');
    // b 与 d 同为 5 星,同分按时间新→旧,所以 d(4000) 在 b(1000) 前
    expect(asc.map(s => s.id)).toEqual(['a', 'd', 'b', 'c']);
    expect(asc[asc.length - 1].id).toBe('c');
    expect(sortSignalsBy(list, 'quality', 'desc').at(-1)?.id).toBe('c');
  });

  it('不改动入参数组', () => {
    const before = list.map(s => s.id);
    sortSignalsBy(list, 'quality', 'desc');
    expect(list.map(s => s.id)).toEqual(before);
  });
});
