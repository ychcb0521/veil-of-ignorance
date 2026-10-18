import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { KLineData } from 'klinecharts';
import { CBI_DEFAULTS, computeCbi, type CbiBar } from '@/lib/cbi';
import { atrSeries, rollingMad, rollingMedian, rollingSum, wsumBars } from '@/lib/deepDig/formula';
import { BUILTIN_FEATURES, CBI_DEF, CBI_FORMULA, compileFeatureFormula, computeFeatureValues, formulaVariables } from '@/lib/deepDig/features';
import { cbiPoints, CUSTOM_INDICATOR_MAP } from '@/lib/customIndicators';
import { mulberry32 } from '@/lib/deepRsa/grouping';
import { BAR_MS, type ResearchBar } from '@/lib/deepRsa/window';
import { IndicatorMenu } from '@/components/IndicatorMenu';

function bars(n: number, seed: number, opts: { barMs?: number; drift?: (i: number) => number; buyBias?: (i: number) => number; closeAt?: (i: number) => number; missingEvery?: number } = {}): ResearchBar[] {
  const rand = mulberry32(seed);
  const barMs = opts.barMs ?? BAR_MS;
  let close = 100;
  return Array.from({ length: n }, (_, i) => {
    const open = close;
    const move = (opts.drift?.(i) ?? 0) + 0.004 * (rand() - 0.5);
    const hi = Math.max(open, open * Math.exp(move)) * (1 + 0.002 * rand());
    const lo = Math.min(open, open * Math.exp(move)) * (1 - 0.002 * rand());
    // closeAt：收在区间里的位置（0 = 最低、1 = 最高）
    close = opts.closeAt ? lo + (hi - lo) * opts.closeAt(i) : open * Math.exp(move);
    const q = 2e5 * (0.3 + rand()) * (i % 97 === 0 ? 4 : 1);
    const share = Math.min(0.98, Math.max(0.02, 0.5 + (opts.buyBias?.(i) ?? 0) + 0.3 * (rand() - 0.5)));
    const missing = (opts.missingEvery ?? 0) > 0 && i % opts.missingEvery! === 5;
    return { openTime: i * barMs, open, high: Math.max(hi, close), low: Math.min(lo, close), close, volume: q / close, takerBuyVolume: null, quoteVolume: missing ? null : q, takerBuyQuoteVolume: missing ? null : q * share };
  });
}
const toCbi = (b: ResearchBar[]): CbiBar[] => b.map(x => ({ high: x.high, low: x.low, close: x.close, quoteVolume: x.quoteVolume, takerBuyQuoteVolume: x.takerBuyQuoteVolume }));
const windowOf = (b: ResearchBar[], barMs = BAR_MS) => ({ anchorMs: b.length * barMs, aligned: true, bars: b, expectedBars: b.length, missingBars: 0, coverage: 1, missingTakerBars: 0 });

// ---------- 照笔记逐项直接算（不共用实现）----------
const fins = (xs: number[]) => xs.filter(Number.isFinite);
const med = (xs: number[]) => { const s = fins(xs).sort((a, b) => a - b); if (!s.length) return Number.NaN; const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
const mad = (xs: number[]) => { const m = med(xs); return med(fins(xs).map(v => Math.abs(v - m))); };
/** 稳健尺度：1.4826·MAD；MAD = 0 时 1.2533·平均绝对偏差。 */
const rscale = (xs: number[]) => { const f = fins(xs); if (!f.length) return Number.NaN; const md = mad(f); if (md > 0) return 1.4826 * md; const m = med(f); return 1.2533 * f.reduce((a, c) => a + Math.abs(c - m), 0) / f.length; };
function cbiByDefinition(b: CbiBar[], barMin: number, p = CBI_DEFAULTS): number[] {
  const T = b.length;
  const base = Math.round(p.baseHours * 60 / barMin);
  const idx = (lo: number, hi: number) => Array.from({ length: Math.max(0, hi - lo + 1) }, (_, k) => lo + k).filter(i => i >= 0 && i < T);
  const Q = b.map(x => x.quoteVolume ?? Number.NaN);
  const B = b.map(x => x.takerBuyQuoteVolume ?? Number.NaN);
  const net = Q.map((q, i) => B[i] - (q - B[i]));
  // ATR：真实波幅 Wilder 14 根
  const tr = b.map((x, i) => (i === 0 ? x.high - x.low : Math.max(x.high - x.low, Math.abs(x.high - b[i - 1].close), Math.abs(x.low - b[i - 1].close))));
  const atr: number[] = [];
  tr.forEach((v, i) => { atr.push(i < p.atrBars - 1 ? Number.NaN : i === p.atrBars - 1 ? tr.slice(0, p.atrBars).reduce((a, c) => a + c, 0) / p.atrBars : (atr[i - 1] * (p.atrBars - 1) + v) / p.atrBars); });
  const vbar = b.map((_, i) => med(idx(i - base, i - 1).map(j => Q[j])));
  const x = net.map((v, i) => v / vbar[i]);
  const r = b.map((c, i) => (i === 0 ? Number.NaN : (c.close - b[i - 1].close) / atr[i]));
  const wsum = (t: number, f: (i: number) => number) => {
    let s = 0; let any = false;
    for (const i of idx(t - p.n + 1, t)) { const v = f(i); if (Number.isFinite(v)) { s += 2 ** (-(t - i) / p.h) * v; any = true; } }
    return any ? s : Number.NaN;
  };
  const F = b.map((_, t) => wsum(t, i => net[i]) / wsum(t, i => Q[i]));
  const lam0 = b.map((_, t) => {
    const js = idx(t - base + 1, t);
    return fins(js.map(j => r[j] * Math.sign(x[j]))).reduce((a, c) => a + c, 0) / fins(js.map(j => Math.abs(x[j]))).reduce((a, c) => a + c, 0);
  });
  const A = b.map((_, t) => {
    const up = (wsum(t, i => (x[i] > 0 ? r[i] : Number.isNaN(x[i]) ? Number.NaN : 0)) + p.kappa * lam0[t]) / (wsum(t, i => (x[i] > 0 ? x[i] : Number.isNaN(x[i]) ? Number.NaN : 0)) + p.kappa);
    const dn = (wsum(t, i => (x[i] < 0 ? r[i] : Number.isNaN(x[i]) ? Number.NaN : 0)) - p.kappa * lam0[t]) / (wsum(t, i => (x[i] < 0 ? x[i] : Number.isNaN(x[i]) ? Number.NaN : 0)) - p.kappa);
    return (up - dn) / (Math.abs(up) + Math.abs(dn));
  });
  const clv = b.map(c => (c.high > c.low ? (2 * c.close - c.high - c.low) / (c.high - c.low) : 0));
  const K = b.map((_, t) => wsum(t, i => Q[i] * clv[i]) / wsum(t, i => Q[i]));
  const M = b.map((_, t) => wsum(t, i => Q[i] * (b[i].high + b[i].low + b[i].close) / 3) / wsum(t, i => Q[i]));
  const d = b.map((c, t) => (c.close - M[t]) / atr[t]);
  const v = b.map((_, t) => (t >= p.m ? (M[t] - M[t - p.m]) / (p.m * atr[t]) : Number.NaN));
  const prevBase = (s: number[], t: number) => idx(t - base, t - 1).map(j => s[j]);
  const z = (val: number, center: number, s: number[], t: number) => (val - center) / rscale(prevBase(s, t));
  const u = (zz: number) => Math.tanh(zz / 2);
  return b.map((_, t) => {
    const uF = u(z(F[t], med(prevBase(F, t)), F, t));
    const uA = u(z(A[t], 0, A, t));
    const uK = u(z(K[t], 0, K, t));
    const uS = (u(z(d[t], 0, d, t)) + u(z(v[t], 0, v, t))) / 2;
    const D = (0.3 * uF + 0.3 * uA + 0.15 * uK + 0.25 * uS) / 1;
    const RV = wsum(t, i => Q[i]) / wsum(t, i => vbar[i]);
    const P = RV ** p.k / (1 + RV ** p.k);
    return P * D;
  });
}

describe('【用户要求】CBI 买方优势指数', () => {
  it('底层函数：滚动中位数 / MAD / 和、时间衰减加权和、ATR 与笨办法一致（含空值）', async () => {
    const rand = mulberry32(9);
    const xs = Float64Array.from({ length: 300 }, (_, i) => (i % 17 === 3 ? Number.NaN : rand() * 10 - 3));
    const n = 25;
    const medR = rollingMedian(xs, n);
    const madR = rollingMad(xs, n);
    const sumR = rollingSum(xs, n);
    const ws = wsumBars(xs, 6, 10);
    for (let i = 0; i < xs.length; i += 7) {
      const win = Array.from(xs.slice(Math.max(0, i - n + 1), i + 1));
      expect(medR[i]).toBeCloseTo(med(win), 12);
      expect(madR[i]).toBeCloseTo(mad(win), 12);
      expect(sumR[i]).toBeCloseTo(fins(win).reduce((a, c) => a + c, 0), 9);
      let w = 0;
      for (let k = 0; k < 10 && k <= i; k++) if (Number.isFinite(xs[i - k])) w += 2 ** (-k / 6) * xs[i - k];
      expect(ws[i]).toBeCloseTo(w, 9);
    }
    // 稳健尺度：一半以上相同（MAD = 0）→ 1.2533 × 平均绝对偏差
    const { rollingRobustScale } = await import('@/lib/deepDig/formula');
    const sc = rollingRobustScale(Float64Array.from([1, 1, 1, 0.2, 1]), 5);
    expect(sc[4]).toBeCloseTo(1.2533 * (0.8 / 5), 12);
    expect(rollingRobustScale(Float64Array.from([1, 2, 4, 8, 16]), 5)[4]).toBeCloseTo(1.4826 * 3, 12); // 中位数 4，偏差 0 2 3 4 12 → MAD 3
    const h = Float64Array.from([10, 11, 12, 11, 13]);
    const l = Float64Array.from([9, 10, 10, 9, 11]);
    const c = Float64Array.from([9.5, 10.5, 11, 10, 12]);
    const atr = atrSeries(h, l, c, 2);
    expect(Number.isNaN(atr[0])).toBe(true);
    expect(atr[1]).toBeCloseTo((1 + 1.5) / 2, 12); // TR = 1、max(1, 1.5, 0.5)
    expect(atr[2]).toBeCloseTo((1.25 + 2) / 2, 12);
  });

  it('computeCbi 与照笔记逐项直接算一致（含缺成交额的 K 线）', () => {
    for (const missingEvery of [0, 43]) {
      const b = toCbi(bars(700, 1, { missingEvery }));
      const pts = computeCbi(b, 5);
      const ref = cbiByDefinition(b, 5);
      for (const t of [360, 500, 699]) expect(pts[t].cbi!).toBeCloseTo(ref[t], 9);
    }
  });

  it('取值在 −1 ~ 1；放量、主动买为主、收在高位、往上走 → 买方占优（> 0）；反过来 → < 0', () => {
    const all = computeCbi(toCbi(bars(1200, 2, { drift: i => 0.008 * Math.sin(i / 30) })), 5).filter(p => p.cbi != null);
    expect(all.length).toBeGreaterThan(800);
    for (const p of all) { expect(Math.abs(p.cbi!)).toBeLessThan(1); expect(p.p!).toBeGreaterThan(0); expect(p.p!).toBeLessThan(1); }
    const bull = computeCbi(toCbi(bars(800, 3, { drift: i => (i > 740 ? 0.002 : 0), buyBias: i => (i > 740 ? 0.25 : 0), closeAt: i => (i > 740 ? 0.9 : 0.5) })), 5).at(-1)!;
    expect(bull.cbi!).toBeGreaterThan(0);
    const bear = computeCbi(toCbi(bars(800, 3, { drift: i => (i > 740 ? -0.002 : 0), buyBias: i => (i > 740 ? -0.25 : 0), closeAt: i => (i > 740 ? 0.1 : 0.5) })), 5).at(-1)!;
    expect(bear.cbi!).toBeLessThan(0);
  });

  it('Deep dig 第五个特征值 CBI：公式与图表指标的 computeCbi 逐根一致（5 分钟、15 分钟；含缺成交额）', () => {
    expect(BUILTIN_FEATURES.slice(0, 5).map(d => d.id)).toEqual(['drift-speed', 'bss', 'cba', 'drift-speed-z', CBI_DEF.id]);
    expect(formulaVariables(CBI_FORMULA).result).toBe('CBI');
    const compiled = compileFeatureFormula(CBI_FORMULA);
    for (const [barMs, missingEvery] of [[BAR_MS, 0], [BAR_MS, 37], [3 * BAR_MS, 0]] as const) {
      const b = bars(700, 4, { barMs, missingEvery });
      const ref = computeCbi(toCbi(b), barMs / 60_000, { baseHours: 24 }).at(-1)!;
      const { value, vars } = computeFeatureValues(windowOf(b, barMs), compiled, { interval: barMs === BAR_MS ? '5m' : '15m', avgHours: 24 });
      expect(value).not.toBeNull();
      expect(value!).toBeCloseTo(ref.cbi!, 9);
      expect(vars.D!).toBeCloseTo(ref.d!, 9);
      expect(vars.P!).toBeCloseTo(ref.p!, 9);
      expect(vars.A!).toBeCloseTo(ref.a!, 9);
    }
  });
});

describe('【用户要求】K 线图指标菜单：CBI（副图）', () => {
  it('副图与 computeCbi 一致；h、N、m、ATR 按根计、基线按 5 分钟图计：1 小时图上读数逐根相同', () => {
    const k = (barMs: number): KLineData[] => bars(700, 6, { barMs }).map(b => ({ timestamp: b.openTime, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume, turnover: b.quoteVolume!, takerBuyTurnover: b.takerBuyQuoteVolume } as KLineData));
    const p5 = cbiPoints(k(BAR_MS), 12);
    expect(p5.map(p => p.cbi)).toEqual(computeCbi(toCbi(bars(700, 6)), 5).map(p => p.cbi));
    expect(cbiPoints(k(12 * BAR_MS), 12).map(p => p.cbi)).toEqual(p5.map(p => p.cbi));
    expect(cbiPoints(k(BAR_MS), 4).at(-1)!.cbi).not.toBeCloseTo(p5.at(-1)!.cbi!, 4);
    expect(CUSTOM_INDICATOR_MAP.CBI).toBe('CBI_CUSTOM');
  });

  it('菜单里有 CBI：名称下面写定义，悬停给出计算步骤；参数默认半衰期 12 根', () => {
    const onChange = vi.fn();
    render(<IndicatorMenu open indicators={[]} onIndicatorsChange={onChange} onClose={() => {}} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'CBI' } });
    expect(screen.getByText(/CBI 买方优势指数（−1 ~ 1）= 参与度 P × 方向 D/)).toHaveAttribute('title', expect.stringContaining('A 吸收 = (λ⁺ − λ⁻) ÷ (|λ⁺| + |λ⁻|)'));
    fireEvent.click(screen.getByText('买方优势指数 CBI'));
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ type: 'CBI', period: 12, enabled: true })]);
  });
});
