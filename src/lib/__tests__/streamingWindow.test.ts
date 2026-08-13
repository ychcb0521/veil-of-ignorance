import { describe, expect, it } from 'vitest';
import {
  barsPerRealSecond,
  isForwardExhausted,
  needsForwardPreload,
  needsReversePreload,
} from '../streamingWindow';

const MIN = 60_000;
const BAR_3M = 3 * MIN;

describe('正放播放窗口', () => {
  const last = 1_000_000_000_000; // 已加载最后一根的开盘时刻
  const PRELOAD = 240;

  it('余量充足时不预取', () => {
    // 距最后一根还有 500 根
    expect(needsForwardPreload(last - 500 * BAR_3M, last, BAR_3M, PRELOAD)).toBe(false);
  });

  it('进入预取区间即触发', () => {
    expect(needsForwardPreload(last - 239 * BAR_3M, last, BAR_3M, PRELOAD)).toBe(true);
    // 恰在边界上也算，宁可早取一次
    expect(needsForwardPreload(last - PRELOAD * BAR_3M, last, BAR_3M, PRELOAD)).toBe(true);
  });

  it('最后一根还在成形时不判耗尽——否则它刚露头就被掐断', () => {
    expect(isForwardExhausted(last, last, BAR_3M)).toBe(false);
    expect(isForwardExhausted(last + BAR_3M, last, BAR_3M)).toBe(false);
  });

  it('越过最后一根的收盘才判耗尽', () => {
    expect(isForwardExhausted(last + BAR_3M + 1, last, BAR_3M)).toBe(true);
  });

  it('这正是卡死的成因：300 根缓冲在 3m/180x 下只够 5 分钟', () => {
    // 3m 周期 180 倍速 = 恰好 1 根/秒
    expect(barsPerRealSecond(180, BAR_3M)).toBeCloseTo(1, 12);
    // 300 根前瞻缓冲 ÷ 1 根每秒 = 300 秒
    expect(300 / barsPerRealSecond(180, BAR_3M)).toBe(300);
    // 而 240 根的预取阈值意味着还剩 240 秒就开始补，取数往返绰绰有余
    expect(240 / barsPerRealSecond(180, BAR_3M)).toBe(240);
  });

  it('1m 周期 900 倍速消耗最快，预取阈值仍留出 16 秒', () => {
    expect(barsPerRealSecond(900, MIN)).toBe(15);
    expect(240 / barsPerRealSecond(900, MIN)).toBe(16);
  });

  it('非法输入一律不触发，不让坏数据引发取数风暴', () => {
    expect(needsForwardPreload(Number.NaN, last, BAR_3M, 240)).toBe(false);
    expect(needsForwardPreload(last, last, 0, 240)).toBe(false);
    expect(isForwardExhausted(last, Number.NaN, BAR_3M)).toBe(false);
  });
});

describe('倒放播放窗口（正放的镜像）', () => {
  const first = 1_000_000_000_000;

  it('接近最早一根时预取更早数据', () => {
    expect(needsReversePreload(first + 500 * BAR_3M, first, BAR_3M, 120)).toBe(false);
    expect(needsReversePreload(first + 119 * BAR_3M, first, BAR_3M, 120)).toBe(true);
  });
});
