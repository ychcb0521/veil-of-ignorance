import { describe, expect, it } from 'vitest';
import {
  BAR_MS, decayWeights, expectedWindowBars, extractWindow, HALF_LIFE_CANDIDATES_H, parseBinanceKlineRow, WINDOW_BARS,
  type ResearchBar,
} from '@/lib/deepRsa/window';
import { computeFeatures, FEATURE_DEFINITIONS, VWAP_BARS } from '@/lib/deepRsa/features';
import { WINDOW_MS } from '@/lib/deepRsa/grouping';

const T0 = Date.parse('2026-05-06T12:00:00Z');

/** 从 t₀ − 48h 起连续 n 根；make(i) 给出第 i 根的字段。 */
function series(n: number, make: (i: number) => Partial<ResearchBar>, start = T0 - WINDOW_MS): ResearchBar[] {
  return Array.from({ length: n }, (_, i) => ({
    openTime: start + i * BAR_MS, open: 100, high: 101, low: 99, close: 100, volume: 10, takerBuyVolume: 5, ...make(i),
  }));
}

describe('研究用 K 线解析：保留主动买入量，非法即丢弃', () => {
  const row = [T0, '100', '102', '99', '101', '10', T0 + BAR_MS - 1, '1000', 42, '6', '600', '0'];

  it('取第 10 列（下标 9）作主动买入量；第 8 / 11 列作成交额 / 主动买入额（USDT，动态谢林点用）', () => {
    expect(parseBinanceKlineRow(row)).toEqual({
      openTime: T0, open: 100, high: 102, low: 99, close: 101, volume: 10, takerBuyVolume: 6, quoteVolume: 1000, takerBuyQuoteVolume: 600,
    });
  });

  it('没有金额两列、或主动买入额超过成交额 → 金额记 null，不拿币数凑', () => {
    expect(parseBinanceKlineRow(row.slice(0, 10))).toMatchObject({ quoteVolume: null, takerBuyQuoteVolume: null, takerBuyVolume: 6 });
    expect(parseBinanceKlineRow([...row.slice(0, 10), '1001'])).toMatchObject({ quoteVolume: null, takerBuyQuoteVolume: null });
  });

  it('没有那一列、或主动买入量超过成交量 → null，不补 0', () => {
    expect(parseBinanceKlineRow(row.slice(0, 6))!.takerBuyVolume).toBeNull();
    expect(parseBinanceKlineRow([...row.slice(0, 9), '11'])!.takerBuyVolume).toBeNull();
  });

  it('价格非法、high < low、收盘在区间外 → 整根丢弃', () => {
    expect(parseBinanceKlineRow([T0, 'x', 1, 1, 1, 1])).toBeNull();
    expect(parseBinanceKlineRow([T0, 100, 98, 99, 100, 1])).toBeNull();
    expect(parseBinanceKlineRow([T0, 100, 101, 99, 102, 1])).toBeNull();
    expect(parseBinanceKlineRow([T0, 0, 1, 0, 1, 1])).toBeNull();
  });
});

describe('观察窗 [t₀ − 48h, t₀)：只收已收盘的 5m K 线', () => {
  it('t₀ 整点 → 576 根；不整点 → 575 根完整槽位', () => {
    expect(WINDOW_BARS).toBe(576);
    expect(expectedWindowBars(T0)).toBe(576);
    expect(expectedWindowBars(T0 + 60_000)).toBe(575);
  });

  it('下界那根含；openTime + 5m = t₀ 那根含；openTime = t₀ 那根（未收盘）不含', () => {
    const bars = series(578, () => ({}), T0 - WINDOW_MS - BAR_MS);
    const w = extractWindow(bars, T0);
    expect(w.bars).toHaveLength(576);
    expect(w.bars[0].openTime).toBe(T0 - WINDOW_MS);
    expect(w.bars.at(-1)!.openTime).toBe(T0 - BAR_MS);
    expect(w).toMatchObject({ aligned: true, expectedBars: 576, missingBars: 0, coverage: 1, missingTakerBars: 0 });
  });

  it('t₀ 不整点：盖住 t₀ 的那根还没收盘，不进窗口', () => {
    const anchor = T0 + 2 * 60_000;
    const w = extractWindow(series(600, () => ({})), anchor);
    expect(w.bars.at(-1)!.openTime + BAR_MS).toBeLessThanOrEqual(anchor);
    expect(w.bars.at(-1)!.openTime).toBe(T0 - BAR_MS);
    expect(w.aligned).toBe(false);
    expect(w.bars).toHaveLength(575);
  });

  it('缺 K 线、重复 K 线：去重并如实报告覆盖率', () => {
    const bars = series(576, () => ({})).filter((_, i) => i % 10 !== 0);
    const w = extractWindow([...bars, bars[3]], T0);
    expect(w.missingBars).toBe(58);
    expect(w.coverage).toBeCloseTo(518 / 576, 12);
  });
});

describe('指数衰减权重 w_i = 2^(−Δt_i/h) / Σ', () => {
  it('和为 1；Δt 相差一个半衰期，权重恰好减半', () => {
    const bars = series(576, () => ({}));
    for (const h of HALF_LIFE_CANDIDATES_H) {
      const w = decayWeights(bars, T0, h);
      expect(w.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 12);
      const stepsPerHalfLife = (h * 60) / 5;
      expect(w[575 - stepsPerHalfLife] / w[575]).toBeCloseTo(0.5, 12);
    }
  });

  it('紧挨 t₀ 收盘的那根权重最大；h 越小越集中在近端', () => {
    const bars = series(576, () => ({}));
    const w2 = decayWeights(bars, T0, 2);
    const w12 = decayWeights(bars, T0, 12);
    expect(Math.max(...w2)).toBe(w2[575]);
    expect(w2[575]).toBeGreaterThan(w12[575]);
  });
});

describe('15 个特征：公式与实现逐条对应', () => {
  it('定义表恰好 15 个，三类表征齐全，与输出键一致', () => {
    expect(FEATURE_DEFINITIONS).toHaveLength(15);
    const out = computeFeatures(extractWindow(series(576, () => ({})), T0), { halfLifeHours: 6 });
    expect(Object.keys(out).sort()).toEqual(FEATURE_DEFINITIONS.map(d => d.key).sort());
    expect(new Set(FEATURE_DEFINITIONS.map(d => d.family))).toEqual(new Set(['price', 'orderFlow', 'schelling']));
    expect(FEATURE_DEFINITIONS.filter(d => d.candidate).map(d => d.family)).toEqual(['schelling', 'schelling', 'schelling']);
  });

  it('等比上涨：ret_w = ln g，vol_w = 0，趋势 R² = +1，收在区间顶附近', () => {
    const g = 1.001;
    const bars = series(576, i => {
      const c = 100 * g ** i;
      return { open: c / g, close: c, high: c * 1.0001, low: (c / g) * 0.9999 };
    });
    const f = computeFeatures(extractWindow(bars, T0), { halfLifeHours: 6 });
    expect(f.ret_w).toBeCloseTo(Math.log(g), 12);
    expect(f.vol_w).toBeCloseTo(0, 9);
    expect(f.trend_r2_w).toBeCloseTo(1, 9);
    expect(f.range_pos!).toBeGreaterThan(0.99);
    expect(f.drawdown_high).toBeCloseTo(Math.log(1 / 1.0001), 9);
    expect(f.updown_vol_w).toBeNull(); // 没有下跌 K 线：量比无定义
    expect(f.absorb_down_w).toBeNull();
  });

  it('主动买入恒为 75%：失衡 = 0.5，近期偏移 = 0；下跌 K 线吸收 = 0.25', () => {
    const bars = series(576, i => ({ close: i % 2 ? 99.5 : 100.5, takerBuyVolume: 7.5 }));
    const f = computeFeatures(extractWindow(bars, T0), { halfLifeHours: 2 });
    expect(f.taker_imb_w).toBeCloseTo(0.5, 12);
    expect(f.taker_imb_shift_w).toBeCloseTo(0, 12);
    expect(f.absorb_down_w).toBeCloseTo(0.25, 12);
    expect(f.updown_vol_w).toBeCloseTo(Math.log(decaySum(bars, 0) / decaySum(bars, 1)), 9);
  });

  it('近端放量、近端主动买入：vol_surge_w、taker_imb_shift_w 为正', () => {
    const bars = series(576, i => (i >= 552 ? { volume: 50, takerBuyVolume: 40 } : {}));
    const f = computeFeatures(extractWindow(bars, T0), { halfLifeHours: 2 });
    expect(f.vol_surge_w!).toBeGreaterThan(0);
    expect(f.taker_imb_shift_w!).toBeGreaterThan(0);
  });

  it('任一根缺主动买入量：三个主动买入特征整组为 null，其他照算', () => {
    const bars = series(576, i => (i === 300 ? { takerBuyVolume: null } : {}));
    const f = computeFeatures(extractWindow(bars, T0), { halfLifeHours: 6 });
    expect([f.taker_imb_w, f.taker_imb_shift_w, f.absorb_down_w]).toEqual([null, null, null]);
    expect(f.vol_surge_w).not.toBeNull();
  });

  it('下影线占比、波动收缩：手算对照', () => {
    // 每根 O=C=100、L=98、H=101 → 下影线占比 2/3；波幅恒定 → 收缩 = ln 1 = 0
    const f = computeFeatures(extractWindow(series(576, () => ({ low: 98 })), T0), { halfLifeHours: 6 });
    expect(f.lower_wick_w).toBeCloseTo(2 / 3, 12);
    expect(f.compression_w).toBeCloseTo(0, 12);
  });

  it('VWAP 只取最后 144 根；POC 落在成交最密的价位；兜底价只在给了才算', () => {
    const bars = series(576, i => (i >= 576 - VWAP_BARS
      ? { open: 110, close: 110, high: 111, low: 109, volume: 10 }
      : { volume: i < 100 ? 100 : 1 }));
    const f = computeFeatures(extractWindow(bars, T0), { halfLifeHours: 12, fallbackPrice: 100 });
    expect(f.vwap12_dev).toBeCloseTo(0, 12); // 最后 144 根 TP = 110 = C_N
    expect(f.fallback_dev).toBeCloseTo(Math.log(110 / 100), 12);
    expect(f.poc_dev_w!).toBeGreaterThan(0); // 早期大量堆在 99–101，C_N = 110 在其上方
    expect(computeFeatures(extractWindow(bars, T0), { halfLifeHours: 12 }).fallback_dev).toBeNull();
  });

  it('跨缺口的那一段不算收益', () => {
    const bars = series(576, i => ({ close: i < 300 ? 100 : 200, open: i < 300 ? 100 : 200, high: i < 300 ? 101 : 201, low: i < 300 ? 99 : 199 }))
      .filter((_, i) => i !== 300 && i !== 299);
    const f = computeFeatures(extractWindow(bars, T0), { halfLifeHours: 6 });
    expect(f.ret_w).toBeCloseTo(0, 12);
    expect(f.vol_w).toBeCloseTo(0, 12);
  });

  it('防未来数据：在 t₀ 之后追加任意 K 线，特征一个都不变', () => {
    const past = series(576, i => ({ close: 100 + Math.sin(i / 7), open: 100, high: 102, low: 98, takerBuyVolume: 3 + (i % 5) }));
    const future = series(200, () => ({ close: 500, open: 500, high: 900, low: 400, volume: 1e6, takerBuyVolume: 1e6 }), T0);
    for (const h of HALF_LIFE_CANDIDATES_H) {
      expect(computeFeatures(extractWindow([...past, ...future], T0), { halfLifeHours: h }))
        .toEqual(computeFeatures(extractWindow(past, T0), { halfLifeHours: h }));
    }
  });

  it('空窗口：全部 null', () => {
    const f = computeFeatures(extractWindow([], T0), { halfLifeHours: 6 });
    expect(Object.values(f).every(v => v === null)).toBe(true);
  });
});

/** parity=0 取上涨（偶数下标收 100.5）、1 取下跌，对应权重 × 成交量之和。 */
function decaySum(bars: ResearchBar[], parity: number): number {
  const w = decayWeights(bars, T0, 2);
  return bars.reduce((s, b, i) => s + (i % 2 === parity ? w[i] * b.volume : 0), 0);
}
