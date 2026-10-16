import { describe, expect, it } from 'vitest';
import { computeDsp, dspDecay, DSP_DEFAULTS, dspHalfLifeForInterval, inferIntervalMs, type DspBar } from '../dynamicSchellingPoint';
import { klineAmountFields } from '@/hooks/useBinanceData';

const M5 = 5 * 60_000;
const bar = (i: number, close: number, q: number | null, b: number | null): DspBar => ({ time: i * M5, close, quoteVolume: q, takerBuyQuoteVolume: b });

describe('动态谢林点 DSP：逐条对照规格', () => {
  it('5 分钟线、半衰期 6 小时：ρ = 2^(−5/360)', () => {
    expect(dspDecay(M5, 6)).toBeCloseTo(2 ** (-5 / 360), 15);
    expect(inferIntervalMs([0, 1, 2, 4].map(i => ({ time: i * M5 })))).toBe(M5);
  });

  it('手算三根：N、EMA、F、A、G、R、U、V、DSP 全部吻合', () => {
    const bars = [bar(0, 100, 1000, 500), bar(1, 101, 2000, 1500), bar(2, 100.5, 1000, 200)];
    const pts = computeDsp(bars);
    const rho = 2 ** (-5 / 360);
    const eps = DSP_DEFAULTS.epsilon;
    // 第 0 根：DSP₀ = C₀，R = 0
    expect(pts[0]).toMatchObject({ dsp: 100, r: 0, u: 0, v: 0, a: 0 });
    // 第 1 根：B = 1500，S = 500，N = 1000；EMA = ρ·1000 + (1−ρ)·2000
    const ema1 = rho * 1000 + (1 - rho) * 2000;
    const f1 = Math.log(1 + 1000 / (ema1 + eps));
    const a1 = 1000 / (2000 + eps);
    const g1 = 1 + a1;
    const r1 = Math.log(101 / 100);
    const v1 = (1 - rho) * f1 * g1 * r1;
    expect(pts[1].f).toBeCloseTo(f1, 12);
    expect(pts[1].a).toBeCloseTo(a1, 12);
    expect(pts[1].g).toBeCloseTo(g1, 12);
    expect(pts[1].u).toBeCloseTo(f1 * g1 * r1, 12);
    expect(pts[1].v).toBeCloseTo(v1, 15);
    expect(pts[1].dsp).toBeCloseTo(100 * Math.exp(v1), 12);
    // 第 2 根：卖方占优（B = 200，S = 800）→ A < 0，G = 1（买方优势权重只加不减），下跌 → U < 0
    const ema2 = rho * ema1 + (1 - rho) * 1000;
    const f2 = Math.log(1 + 600 / (ema2 + eps));
    const r2 = Math.log(100.5 / 101);
    const v2 = rho * v1 + (1 - rho) * f2 * 1 * r2;
    expect(pts[2].a).toBeCloseTo(-0.6, 9);
    expect(pts[2].g).toBe(1);
    expect(pts[2].u).toBeLessThan(0);
    expect(pts[2].v).toBeCloseTo(v2, 15);
    expect(pts[2].dsp).toBeCloseTo(100 * Math.exp(v1) * Math.exp(v2), 12);
  });

  it('α、κ、半衰期可调：α = 0 时买方不加权；κ 放大 DSP 的移动', () => {
    const bars = [bar(0, 100, 1000, 500), bar(1, 102, 1000, 900)];
    expect(computeDsp(bars, { alpha: 0 })[1].g).toBe(1);
    expect(computeDsp(bars, { alpha: 2 })[1].g).toBeCloseTo(1 + 2 * 0.8, 9);
    const k1 = Math.log(computeDsp(bars, { kappa: 1 })[1].dsp! / 100);
    const k5 = Math.log(computeDsp(bars, { kappa: 5 })[1].dsp! / 100);
    expect(k5).toBeCloseTo(5 * k1, 12);
    expect(computeDsp(bars, { halfLifeHours: 1 })[1].v!).toBeGreaterThan(computeDsp(bars, { halfLifeHours: 12 })[1].v!);
  });

  it('大资金 + 买方优势 + 上涨 → 强正值；资金很小 → 影响弱；大资金 + 下跌 → 强负值', () => {
    const base = Array.from({ length: 50 }, (_, i) => bar(i, 100, 1000, 500));
    const strongUp = computeDsp([...base, bar(50, 101, 5000, 4500)]).at(-1)!.u;
    const weakUp = computeDsp([...base, bar(50, 101, 1000, 520)]).at(-1)!.u;
    const strongDown = computeDsp([...base, bar(50, 99, 5000, 500)]).at(-1)!.u;
    expect(strongUp).toBeGreaterThan(10 * weakUp);
    expect(weakUp).toBeGreaterThan(0);
    expect(strongDown).toBeLessThan(-strongUp / 3);
  });

  it('缺成交额：不拿币数凑，A 留空、这一根不推动（F = 0），V 照常衰减', () => {
    const pts = computeDsp([bar(0, 100, 1000, 900), bar(1, 103, 1000, 900), bar(2, 110, null, null)]);
    expect(pts[2].a).toBeNull();
    expect(pts[2].f).toBe(0);
    expect(pts[2].u).toBe(0);
    expect(pts[2].v).toBeCloseTo(dspDecay(M5, 6) * pts[1].v!, 15);
  });

  it('币安 K 线数组 → 金额两列：第 8 列成交额、第 11 列主动买入额；缺列不带', () => {
    expect(klineAmountFields([0, '1', '1', '1', '1', '10', 0, '12345.6', 9, '4', '6000.5', '0'])).toEqual({ quoteVolume: 12345.6, takerBuyQuoteVolume: 6000.5 });
    expect(klineAmountFields([0, '1', '1', '1', '1', '10'])).toEqual({});
    expect(klineAmountFields([0, '1', '1', '1', '1', '10', 0, 'x', 9, '4', '1'])).toEqual({});
  });
});

describe('图表喂数：金额字段（回放逐根推送也要带上）', () => {
  it('chartAmountFields：成交额 → turnover、主动买入额 → takerBuyTurnover；成形中的那根按进度缩放；缺列不带', async () => {
    const { chartAmountFields } = await import('@/hooks/useBinanceData');
    expect(chartAmountFields({ quoteVolume: 1000, takerBuyQuoteVolume: 600 })).toEqual({ turnover: 1000, takerBuyTurnover: 600 });
    expect(chartAmountFields({ quoteVolume: 1000, takerBuyQuoteVolume: 600 }, 0.25)).toEqual({ turnover: 250, takerBuyTurnover: 150 });
    expect(chartAmountFields({})).toEqual({});
    expect(chartAmountFields({ quoteVolume: 1000 })).toEqual({});
  });
});

describe('【用户要求】记忆长度以 5 分钟图为准、随周期等比例缩放', () => {
  const series = (step: number) => Array.from({ length: 120 }, (_, i) => ({
    time: i * step, close: 100 * Math.exp(0.01 * Math.sin(i / 5)),
    quoteVolume: 1000 + 300 * Math.cos(i / 3), takerBuyQuoteVolume: 500 + 200 * Math.sin(i / 4),
  }));

  it('h = 6 → 1 分钟 1.2 小时、15 分钟 18 小时、1 小时 72 小时；每根的 ρ 都等于 5 分钟线的 ρ', () => {
    expect(dspHalfLifeForInterval(6, M5)).toBe(6);
    expect(dspHalfLifeForInterval(6, 60_000)).toBeCloseTo(1.2, 12);
    expect(dspHalfLifeForInterval(6, 15 * 60_000)).toBe(18);
    expect(dspHalfLifeForInterval(6, 3_600_000)).toBe(72);
    for (const iv of [60_000, 15 * 60_000, 3_600_000, 4 * 3_600_000]) {
      expect(dspDecay(iv, dspHalfLifeForInterval(6, iv))).toBeCloseTo(dspDecay(M5, 6), 15);
    }
  });

  it('图表计算：同样的 K 线序列放到 5 分钟 / 15 分钟 / 1 小时图上，V 与 A 逐根相同', async () => {
    const { dspPoints } = await import('@/lib/customIndicators');
    const toChart = (step: number) => series(step).map(b => ({
      timestamp: b.time, open: b.close, high: b.close, low: b.close, close: b.close, volume: 1,
      turnover: b.quoteVolume, takerBuyTurnover: b.takerBuyQuoteVolume,
    }));
    const base = dspPoints(toChart(M5), 6);
    expect(base.at(-1)!.v).not.toBe(0);
    for (const step of [15 * 60_000, 3_600_000]) {
      const pts = dspPoints(toChart(step), 6);
      pts.forEach((p, i) => {
        expect(p.v).toBeCloseTo(base[i].v!, 15);
        expect(p.a).toBeCloseTo(base[i].a!, 15);
      });
    }
    // 对照：旧做法（半衰期固定 6 小时）在 1 小时图上 V 跟 5 分钟图不一样
    const fixed = computeDsp(series(3_600_000), { halfLifeHours: 6 });
    expect(Math.abs(fixed.at(-1)!.v! - base.at(-1)!.v!)).toBeGreaterThan(1e-6);
  });
});
