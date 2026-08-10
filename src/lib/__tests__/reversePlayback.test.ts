import { describe, expect, it } from 'vitest';
import type { KlineData } from '@/hooks/useBinanceData';
import {
  getReverseVisibleData,
  mirrorSettledBar,
  mirrorTime,
  reverseFormingBar,
  snapToBarStart,
} from '../reversePlayback';

const MIN = 60_000;
// 与真实 Binance 数据一致：K 线开盘按纪元整除对齐（1_600_000_020_000 = 26_666_667 × 60_000）
const BASE = 1_600_000_020_000;

// 四根连续 1m 蜡烛：相邻收开衔接（close[i] == open[i+1]），便于验证镜像连续性
const CANDLES: KlineData[] = [
  { time: BASE + 0 * MIN, open: 100, high: 113, low: 99, close: 110, volume: 10 },
  { time: BASE + 1 * MIN, open: 110, high: 123, low: 109, close: 120, volume: 11 },
  { time: BASE + 2 * MIN, open: 120, high: 133, low: 119, close: 130, volume: 12 },
  { time: BASE + 3 * MIN, open: 130, high: 143, low: 129, close: 140, volume: 13 },
];
// cap = 第 4 根的开盘：倒放从这里开始，第 4 根（正放中成形到一半的那根）永不显示
const CAP = BASE + 3 * MIN;

describe('mirrorTime / snapToBarStart', () => {
  it('时间反射是对合：镜像两次回到原值', () => {
    expect(mirrorTime(CAP, mirrorTime(CAP, BASE + 7_000))).toBe(BASE + 7_000);
  });

  it('真实时间越早 → 镜像时间越晚，且保持 K 线栅格对齐', () => {
    const m2 = mirrorTime(CAP, BASE + 2 * MIN);
    const m1 = mirrorTime(CAP, BASE + 1 * MIN);
    expect(m1 - m2).toBe(MIN);
    expect(m2 % MIN).toBe(BASE % MIN);
  });

  it('snapToBarStart 向下对齐到所在蜡烛开盘', () => {
    expect(snapToBarStart(BASE + MIN + 42_000, MIN)).toBe(BASE + MIN);
    expect(snapToBarStart(BASE + MIN, MIN)).toBe(BASE + MIN);
  });
});

describe('mirrorSettledBar', () => {
  it('开收互换、高低与量不变——阳线在镜像里变阴线', () => {
    const m = mirrorSettledBar(CANDLES[1], CAP);
    expect(m).toEqual({
      time: mirrorTime(CAP, CANDLES[1].time),
      open: 120, close: 110, high: 123, low: 109, volume: 11,
    });
    expect(m.open > m.close).toBe(true); // 真实阳线 → 镜像阴线
  });
});

describe('reverseFormingBar', () => {
  it('主观进度 p=(收盘时刻−simTime)÷周期：从真实收盘价向开盘价回走', () => {
    const bar = CANDLES[2];
    // 时钟走到该蜡烛 3/4 处 → 主观已消费 1/4
    const f = reverseFormingBar(bar, bar.time + MIN * 0.75, MIN, CAP);
    expect(f.open).toBe(130);
    expect(f.close).toBeCloseTo(130 + (120 - 130) * 0.25, 10);
    expect(f.volume).toBeCloseTo(12 * 0.25, 10);
  });

  it('其 close 恒等于正放插值公式在同一时刻的取值（显示价与撮合价同域）', () => {
    const bar = CANDLES[2];
    for (const frac of [0.1, 0.5, 0.9]) {
      const simTime = bar.time + MIN * frac;
      const forwardInterp = bar.open + (bar.close - bar.open) * frac;
      expect(reverseFormingBar(bar, simTime, MIN, CAP).close).toBeCloseTo(forwardInterp, 10);
    }
  });

  it('时钟到达开盘（p=1）时与整根镜像蜡烛完全一致——落定无缝', () => {
    const bar = CANDLES[2];
    expect(reverseFormingBar(bar, bar.time, MIN, CAP)).toEqual(mirrorSettledBar(bar, CAP));
  });
});

describe('getReverseVisibleData', () => {
  it('镜像时间严格递增，相邻蜡烛收开衔接（镜像连续性）', () => {
    const out = getReverseVisibleData(CANDLES, BASE + 1 * MIN, CAP, MIN);
    // 可见：第 4 根（cap 后的主观历史）+ 第 3 根 + 第 2 根（恰好整根揭示）
    expect(out).toHaveLength(3);
    for (let i = 1; i < out.length; i++) {
      expect(out[i].time - out[i - 1].time).toBe(MIN); // 镜像时间严格递增
      expect(out[i - 1].close).toBe(out[i].open);      // 收开衔接
    }
  });

  it('cap 之后（真实更晚）的蜡烛作为主观历史铺在左侧——镜像时间小于起点侧', () => {
    const out = getReverseVisibleData(CANDLES, BASE, CAP, MIN);
    expect(out).toHaveLength(4); // 第 4 根（cap 之后）也在
    // 第 4 根真实最晚 → 镜像最早 → 排在最左（数组最前）
    expect(out[0].time).toBe(mirrorTime(CAP, CANDLES[3].time));
    expect(out[0]).toMatchObject({ open: 140, close: 130 }); // 已落定的镜像（开收互换）
  });

  it('主观未来（真实更早）被幕遮蔽：时钟未到的蜡烛不显示', () => {
    // 时钟刚进入第 3 根 → 第 4 根为主观历史、第 3 根成形中；第 1、2 根还在主观未来
    const out = getReverseVisibleData(CANDLES, BASE + 2 * MIN + 30_000, CAP, MIN);
    expect(out).toHaveLength(2);
    expect(out[1].open).toBe(130); // 成形中的一根从真实收盘价开始回走
  });

  it('倒放起点瞬间（simTime == cap）即呈现真实未来一侧作为主观历史', () => {
    const atStart = getReverseVisibleData(CANDLES, CAP, CAP, MIN);
    expect(atStart).toHaveLength(1); // 夹具里 cap 之后只有第 4 根
    expect(atStart[0]).toMatchObject({ open: 140, close: 130 });
    // 时钟倒退后，cap 之前的蜡烛开始逐帧出现在右侧
    const later = getReverseVisibleData(CANDLES, CAP - 1_000, CAP, MIN);
    expect(later).toHaveLength(2);
    expect(later[1].time).toBeGreaterThan(later[0].time);
  });
});
