import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { KLineData } from 'klinecharts';
import { CBA_DEFAULTS, computeCba, type CbaBar } from '@/lib/cba';
import { barsForHours, retainSum } from '@/lib/deepDig/formula';
import { BUILTIN_FEATURES, CBA_DEF, CBA_FORMULA, compileFeatureFormula, computeFeatureValues, formulaVariables } from '@/lib/deepDig/features';
import { cbaPoints, CUSTOM_INDICATOR_MAP } from '@/lib/customIndicators';
import { mulberry32 } from '@/lib/deepRsa/grouping';
import { BAR_MS, type ResearchBar } from '@/lib/deepRsa/window';
import { IndicatorMenu } from '@/components/IndicatorMenu';

/** 合成 K 线：drift(i) = 第 i 根的趋势，buyBias(i) = 主动买入占比偏移。 */
function bars(n: number, seed: number, opts: { barMs?: number; drift?: (i: number) => number; buyBias?: (i: number) => number; missingEvery?: number } = {}): ResearchBar[] {
  const rand = mulberry32(seed);
  const barMs = opts.barMs ?? BAR_MS;
  let close = 100;
  return Array.from({ length: n }, (_, i) => {
    const open = close;
    close = open * Math.exp((opts.drift?.(i) ?? 0) + 0.004 * (rand() - 0.5));
    const q = 2e5 * (0.3 + rand());
    const vwap = (open + close) / 2 * (1 + 0.0005 * (rand() - 0.5));
    const missing = (opts.missingEvery ?? 0) > 0 && i % opts.missingEvery! === 7;
    const share = Math.min(0.98, Math.max(0.02, 0.5 + (opts.buyBias?.(i) ?? 0) + 0.3 * (rand() - 0.5)));
    return {
      openTime: i * barMs, open, high: Math.max(open, close) * 1.001, low: Math.min(open, close) * 0.999, close,
      volume: q / vwap, takerBuyVolume: null, quoteVolume: missing ? null : q, takerBuyQuoteVolume: missing ? null : q * share,
    };
  });
}
const toCba = (b: ResearchBar[]): CbaBar[] => b.map(x => ({ close: x.close, volume: x.volume, quoteVolume: x.quoteVolume, takerBuyQuoteVolume: x.takerBuyQuoteVolume }));
const windowOf = (b: ResearchBar[], barMs = BAR_MS) => ({ anchorMs: b.length * barMs, aligned: true, bars: b, expectedBars: b.length, missingBars: 0, coverage: 1, missingTakerBars: 0 });

/** 照笔记逐项直接算（不共用实现），核对 computeCba。 */
function cbaByDefinition(b: CbaBar[], barMin: number, t: number, p = CBA_DEFAULTS): number | null {
  const n = barsForHours(p.windowHours, barMin);
  const m = barsForHours(p.normHours, barMin);
  const E = (i: number) => (i >= 0 && b[i].quoteVolume != null && b[i].volume! > 0 ? b[i].quoteVolume! / b[i].volume! : Number.NaN);
  const mean = (xs: number[]) => { const f = xs.filter(Number.isFinite); return f.length ? f.reduce((a, c) => a + c, 0) / f.length : Number.NaN; };
  const sd = (xs: number[]) => { const f = xs.filter(Number.isFinite); if (f.length < 2) return Number.NaN; const mu = mean(f); return Math.sqrt(f.reduce((a, c) => a + (c - mu) ** 2, 0) / (f.length - 1)); };
  const range = (lo: number, hi: number) => Array.from({ length: Math.max(0, hi - lo + 1) }, (_, k) => lo + k).filter(i => i >= 0);
  // V̄ᵢ₋₁：截至上一根、过去 24 小时平均成交额；σₜ₋₁：截至上一根、过去 24 小时成交均价对数收益率的样本标准差
  const vbar = (i: number) => mean(range(i - m, i - 1).map(j => b[j].quoteVolume ?? Number.NaN));
  const sigma = sd(range(t - m, t - 1).map(j => Math.log(E(j) / E(j - 1))));
  const P = Math.min(E(t), b[t].close);
  let num = 0;
  let den = 0;
  for (const i of range(t - n + 1, t)) {
    const w = 2 ** (-((t - i) * barMin / 60) / p.halfLifeHours);
    den += w;
    const V = b[i].quoteVolume ?? Number.NaN;
    const B = b[i].takerBuyQuoteVolume ?? Number.NaN;
    const D = B - (V - B);
    const F = Math.log(1 + (Math.abs(D) + p.eta * (V - Math.abs(D))) / vbar(i));
    const G = 1 + p.alpha * Math.max(D / V, 0);
    const R = Math.log(P / E(i - 1)) / ((t - i + 1) * sigma);
    const term = F * G * R;
    if (Number.isFinite(term)) num += w * term;
  }
  const out = 100 * Math.tanh(num / den);
  return Number.isFinite(out) ? out : null;
}

describe('【用户要求】CBA 买方定价优势指数', () => {
  it('computeCba 与照笔记逐项直接算的结果一致（含缺成交额的 K 线）', () => {
    for (const missingEvery of [0, 41]) {
      const b = toCba(bars(700, 1, { missingEvery }));
      const pts = computeCba(b, 5);
      for (const t of [300, 577, 650, 699]) expect(pts[t].cba!).toBeCloseTo(cbaByDefinition(b, 5, t)!, 9);
    }
  });

  it('retain：时间权重归一化、按 t − i + 1 折成每根速度；窗口外不算；空值那一项记 0', () => {
    const k = Float64Array.from([1, 2, Number.NaN, 4]);
    const p = Float64Array.from([10, 11, 12, 13]);
    const e0 = Float64Array.from([Number.NaN, 10, 11, 12]);
    const rho = 0.5;
    const out = retainSum(k, p, e0, rho, 3);
    // t = 3，窗口 3 根（i = 1..3）：权重 1, 0.5, 0.25（i = 3, 2, 1），i = 2 的 K 为空
    const ref = (1 * 4 * Math.log(13 / 12) / 1 + 0.25 * 2 * Math.log(13 / 10) / 3) / 1.75;
    expect(out[3]).toBeCloseTo(ref, 12);
    expect(out[0]).toBe(0); // E0 为空：这一项记 0
  });

  it('取值在 −100 ~ 100；涨上去守得住（主动买为主）为正，拉高后跌回起点以下为负', () => {
    const wild = computeCba(toCba(bars(1500, 2, { drift: i => 0.01 * Math.sin(i / 40) })), 5).filter(p => p.cba != null);
    expect(wild.length).toBeGreaterThan(1300);
    for (const p of wild) expect(Math.abs(p.cba!)).toBeLessThan(100);
    const up = computeCba(toCba(bars(900, 3, { drift: i => (i > 600 ? 0.002 : 0), buyBias: i => (i > 600 ? 0.15 : 0) })), 5).at(-1)!;
    expect(up.cba!).toBeGreaterThan(20);
    const fade = computeCba(toCba(bars(900, 3, { drift: i => (i > 600 && i < 700 ? 0.003 : i >= 700 ? -0.004 : 0), buyBias: i => (i > 600 && i < 700 ? 0.15 : 0) })), 5).at(-1)!;
    expect(fade.cba!).toBeLessThan(0);
  });

  it('Deep dig 第三个特征值 CBA：公式与图表指标的 computeCba 逐根一致（5 分钟、15 分钟；含缺成交额）', () => {
    expect(BUILTIN_FEATURES.map(d => d.id)).toEqual(['drift-speed', 'bss', CBA_DEF.id, 'drift-speed-z']);
    expect(formulaVariables(CBA_FORMULA)).toEqual({ names: ['eta', 'alpha', 'D', 'A', 'Vbar', 'F', 'G', 'P', 'sig', 'CBA'], result: 'CBA' });
    const compiled = compileFeatureFormula(CBA_FORMULA);
    for (const [barMs, missingEvery] of [[BAR_MS, 0], [BAR_MS, 37], [3 * BAR_MS, 0]] as const) {
      const b = bars(700, 4, { barMs, missingEvery });
      const ref = computeCba(toCba(b), barMs / 60_000, { halfLifeHours: 6, normHours: 24 }).at(-1)!;
      const { value, vars } = computeFeatureValues(windowOf(b, barMs), compiled, { interval: barMs === BAR_MS ? '5m' : '15m', halfLifeHours: 6, avgHours: 24 });
      expect(value).not.toBeNull();
      expect(value!).toBeCloseTo(ref.cba!, 9);
      expect(vars.F!).toBeCloseTo(ref.f!, 12);
      expect(vars.sig!).toBeCloseTo(ref.sigma!, 12);
    }
    // 半衰期跟着 hl 走
    const b = bars(700, 5);
    expect(computeFeatureValues(windowOf(b), compiled, { halfLifeHours: 2, avgHours: 24 }).value!).toBeCloseTo(computeCba(toCba(b), 5, { halfLifeHours: 2 }).at(-1)!.cba!, 9);
  });
});

describe('【用户要求】K 线图指标菜单：CBA（副图）', () => {
  it('副图读成交额 / 主动买入额 / 成交量，与 computeCba 一致；窗口按 5 分钟图计、1 小时图上每根窗口根数相同', () => {
    const k = (barMs: number): KLineData[] => bars(700, 6, { barMs }).map(b => ({ timestamp: b.openTime, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume, turnover: b.quoteVolume!, takerBuyTurnover: b.takerBuyQuoteVolume } as KLineData));
    const p5 = cbaPoints(k(BAR_MS), 6);
    expect(p5.map(p => p.cba)).toEqual(computeCba(toCba(bars(700, 6)), 5, { halfLifeHours: 6 }).map(p => p.cba));
    expect(cbaPoints(k(12 * BAR_MS), 6).map(p => p.cba)).toEqual(p5.map(p => p.cba));
    expect(cbaPoints(k(BAR_MS), 2).at(-1)!.cba).not.toBeCloseTo(p5.at(-1)!.cba!, 4);
    expect(CUSTOM_INDICATOR_MAP.CBA).toBe('CBA_CUSTOM');
  });

  it('菜单里有 CBA：名称下面写定义，悬停给出计算步骤；参数默认半衰期 6 小时', () => {
    const onChange = vi.fn();
    render(<IndicatorMenu open indicators={[]} onIndicatorsChange={onChange} onClose={() => {}} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'CBA' } });
    expect(screen.getByText(/CBA 买方定价优势指数（−100 ~ 100）/)).toHaveAttribute('title', expect.stringContaining('保留上移速度 Rᵢ,ₜ = ln[min(Eₜ, Cₜ) ÷ Eᵢ₋₁] ÷ ((t − i + 1)·σ)'));
    fireEvent.click(screen.getByText('买方定价优势指数 CBA'));
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ type: 'CBA', period: 6, enabled: true })]);
  });
});
