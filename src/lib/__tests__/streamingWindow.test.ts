import { describe, expect, it } from 'vitest';
import {
  barsPerRealSecond,
  forwardPreloadBars,
  isForwardExhausted,
  needsForwardPreload,
  needsReversePreload,
  reversePreloadBars,
  FORWARD_RUNWAY_SECONDS,
  MIN_FORWARD_PRELOAD_BARS,
  MIN_REVERSE_PRELOAD_BARS,
  PREFETCH_BATCH_BARS,
  PREFETCH_BUDGET_SECONDS,
  REVERSE_RUNWAY_SECONDS,
  FETCH_HANG_TIMEOUT_MS,
} from '../streamingWindow';
import { SIMULATION_SPEED_OPTIONS } from '../simulationSpeeds';
import { ALL_TIMEFRAMES } from '@/hooks/useTimeframePrefs';
import { intervalToMs } from '@/hooks/useBinanceData';

const MIN = 60_000;
const BAR_3M = 3 * MIN;

describe('正放播放窗口', () => {
  const last = 1_000_000_000_000; // 已加载最后一根的开盘时刻
  // 不写字面量：阈值现在由「余量秒数」算出，这里取旧的最快组合 900x/1m，
  // 于是这组边界用例检验的仍是线上真正用的那个数。
  const PRELOAD = forwardPreloadBars(900, MIN);

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

  it('1m 周期 3600 倍速消耗最快；阈值按秒计，各倍速余量都不缩水', () => {
    expect(barsPerRealSecond(900, MIN)).toBe(15);
    expect(barsPerRealSecond(1800, MIN)).toBe(30);
    expect(barsPerRealSecond(3600, MIN)).toBe(60);
    // 旧的最快组合：240 根正是「16 秒」，这两个数从来是同一个数
    expect(forwardPreloadBars(900, MIN)).toBe(240);
    expect(forwardPreloadBars(900, MIN) / barsPerRealSecond(900, MIN)).toBe(FORWARD_RUNWAY_SECONDS);
    // 新档位：根数翻倍，秒数不变
    expect(forwardPreloadBars(1800, MIN)).toBe(480);
    expect(forwardPreloadBars(3600, MIN)).toBe(960);
    expect(forwardPreloadBars(3600, MIN) / barsPerRealSecond(3600, MIN)).toBe(FORWARD_RUNWAY_SECONDS);
    expect(reversePreloadBars(3600, MIN)).toBe(480);
    expect(reversePreloadBars(3600, MIN) / barsPerRealSecond(3600, MIN)).toBe(REVERSE_RUNWAY_SECONDS);
    // 若仍用固定 240/120：3600x/1m 只剩 4 秒 / 2 秒，倒放那 2 秒比重试节流本身还短
    expect(240 / barsPerRealSecond(3600, MIN)).toBe(4);
    expect(120 / barsPerRealSecond(3600, MIN)).toBe(2);
  });

  it('等价性：既有倍速的阈值一根不变（旧的 240/120 就是 900x/1m 的 16 秒 / 8 秒）', () => {
    const legacySpeeds = [1, 2, 5, 10, 30, 60, 180, 300, 900];
    for (const speed of legacySpeeds) {
      for (const tf of ALL_TIMEFRAMES) {
        const iMs = intervalToMs(tf);
        expect(forwardPreloadBars(speed, iMs)).toBe(MIN_FORWARD_PRELOAD_BARS);
        expect(reversePreloadBars(speed, iMs)).toBe(MIN_REVERSE_PRELOAD_BARS);
      }
    }
  });

  it('坏输入退回旧常量，绝不放大阈值', () => {
    expect(forwardPreloadBars(Number.NaN, MIN)).toBe(MIN_FORWARD_PRELOAD_BARS);
    expect(forwardPreloadBars(900, 0)).toBe(MIN_FORWARD_PRELOAD_BARS);
    expect(reversePreloadBars(Number.NaN, MIN)).toBe(MIN_REVERSE_PRELOAD_BARS);
  });

  it('一次取数吃掉的根数必须远小于一批——否则补完仍在阈值内，每帧重触发', () => {
    // 真正的死循环条件与阈值大小无关：补完后剩余 = 阈值 − 途中消耗 + 一批，
    // 阈值两边抵消，只要「途中消耗 < 一批」条件就必然转假。
    for (const speed of SIMULATION_SPEED_OPTIONS) {
      for (const tf of ALL_TIMEFRAMES) {
        const iMs = intervalToMs(tf);
        const consumedInFlight = barsPerRealSecond(speed, iMs) * (FETCH_HANG_TIMEOUT_MS / 1000);
        expect(consumedInFlight).toBeLessThan(PREFETCH_BATCH_BARS);
      }
    }
    // 最紧的一格：3600x/1m
    expect(barsPerRealSecond(3600, MIN) * (FETCH_HANG_TIMEOUT_MS / 1000)).toBe(600);
  });

  it('正放与倒放余量都覆盖「一次失败 + 节流 + 一次成功」的预算', () => {
    for (const speed of SIMULATION_SPEED_OPTIONS) {
      for (const tf of ALL_TIMEFRAMES) {
        const iMs = intervalToMs(tf);
        const runway = forwardPreloadBars(speed, iMs) / barsPerRealSecond(speed, iMs);
        expect(runway).toBeGreaterThanOrEqual(PREFETCH_BUDGET_SECONDS);
      }
    }
    // 倒放最紧的一格是 8 秒（= 今天 900x/1m 的既有余量），对 5 秒预算仍有 1.6 倍富余
    for (const speed of SIMULATION_SPEED_OPTIONS) {
      for (const tf of ALL_TIMEFRAMES) {
        const iMs = intervalToMs(tf);
        const runway = reversePreloadBars(speed, iMs) / barsPerRealSecond(speed, iMs);
        expect(runway).toBeGreaterThanOrEqual(PREFETCH_BUDGET_SECONDS);
      }
    }
    expect(PREFETCH_BUDGET_SECONDS).toBe(5);
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
