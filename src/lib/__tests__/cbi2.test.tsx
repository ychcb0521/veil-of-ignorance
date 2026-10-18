import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { KLineData } from 'klinecharts';
import { computeCbi2, type Cbi2Bar } from '@/lib/cbi2';
import { evaluateProgram, parseFormula, rollingBeta, rollingExtreme } from '@/lib/deepDig/formula';
import { BUILTIN_FEATURES, CBI2_DEF, CBI2_FORMULA, compileFeatureFormula, computeFeatureValues, DRIFT_SPEED_DEF } from '@/lib/deepDig/features';
import { cbi2Points, CUSTOM_INDICATOR_MAP, indicatorCalcParams } from '@/lib/customIndicators';
import { btcReferenceVersion, ingestBtcBars, requestBtcReference, resetBtcReference, subscribeBtcReference } from '@/lib/btcReference';
import { clearMarketDataCache, type FetchFn } from '@/lib/deepRsa/marketData';
import { collectDeepDigRun } from '@/lib/deepDig/analysis';
import type { CampaignGroupReport, CampaignGroupRow } from '@/lib/deepRsa/report';
import { mulberry32 } from '@/lib/deepRsa/grouping';
import { BAR_MS, type ResearchBar } from '@/lib/deepRsa/window';
import { IndicatorMenu } from '@/components/IndicatorMenu';

/** 合成 5 分钟 K 线（带同时段 BTC）：币的涨跌 = beta × BTC 涨跌 + 自己的部分。 */
function bars(n: number, seed: number, opts: { beta?: number; own?: number; missingEvery?: number; noBtc?: boolean } = {}): ResearchBar[] {
  const rand = mulberry32(seed);
  let close = 100;
  let btc = 60_000;
  return Array.from({ length: n }, (_, i) => {
    const rb = 0.003 * (rand() - 0.5);
    btc *= Math.exp(rb);
    const open = close;
    close = open * Math.exp((opts.beta ?? 1.2) * rb + (opts.own ?? 0.004) * (rand() - 0.5));
    const q = 2e5 * (0.3 + rand()) * (i % 89 === 0 ? 5 : 1);
    const share = Math.min(0.97, Math.max(0.03, 0.5 + 0.35 * (rand() - 0.5)));
    const missing = (opts.missingEvery ?? 0) > 0 && i % opts.missingEvery! === 4;
    return {
      openTime: i * BAR_MS, open, high: Math.max(open, close) * (1 + 0.002 * rand()), low: Math.min(open, close) * (1 - 0.002 * rand()), close,
      volume: q / close, takerBuyVolume: null, quoteVolume: missing ? null : q, takerBuyQuoteVolume: missing ? null : q * share, refClose: opts.noBtc ? null : btc,
    };
  });
}
const toCbi2 = (b: ResearchBar[]): Cbi2Bar[] => b.map(x => ({ open: x.open, high: x.high, low: x.low, close: x.close, volume: x.volume, quoteVolume: x.quoteVolume, takerBuyQuoteVolume: x.takerBuyQuoteVolume, refClose: x.refClose }));
const windowOf = (b: ResearchBar[]) => ({ anchorMs: b.length * BAR_MS, aligned: true, bars: b, expectedBars: b.length, missingBars: 0, coverage: 1, missingTakerBars: 0 });

// ---------- 照笔记逐项直接算（不共用实现）----------
const fins = (xs: number[]) => xs.filter(Number.isFinite);
const med = (xs: number[]) => { const s = fins(xs).sort((a, b) => a - b); if (!s.length) return Number.NaN; const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
const mad = (xs: number[]) => { const m = med(xs); return med(fins(xs).map(v => Math.abs(v - m))); };
const rscale = (xs: number[]) => { const f = fins(xs); if (!f.length) return Number.NaN; const md = mad(f); if (md > 0) return 1.4826 * md; const m = med(f); return 1.2533 * f.reduce((a, c) => a + Math.abs(c - m), 0) / f.length; };
const sdS = (xs: number[]) => { const f = fins(xs); if (f.length < 2) return Number.NaN; const mu = f.reduce((a, c) => a + c, 0) / f.length; return Math.sqrt(f.reduce((a, c) => a + (c - mu) ** 2, 0) / (f.length - 1)); };
const sumF = (xs: number[]) => { const f = fins(xs); return f.length ? f.reduce((a, c) => a + c, 0) : Number.NaN; };
function cbi2ByDefinition(b: ResearchBar[], t: number): number {
  const T = b.length;
  const BASE = 288;
  const C = b.map(x => x.close), H = b.map(x => x.high), L = b.map(x => x.low);
  const Q = b.map(x => x.quoteVolume ?? Number.NaN), B = b.map(x => x.takerBuyQuoteVolume ?? Number.NaN);
  const S = Q.map((q, i) => q - B[i]);
  const CB = b.map(x => x.refClose ?? Number.NaN);
  const win = (end: number, n: number) => Array.from({ length: n }, (_, k) => end - k).filter(i => i >= 0 && i < T);
  const prevWin = (i: number) => win(i - 1, BASE);
  // ATR：Wilder 14
  const tr = b.map((x, i) => (i === 0 ? x.high - x.low : Math.max(x.high - x.low, Math.abs(x.high - C[i - 1]), Math.abs(x.low - C[i - 1]))));
  const ATR: number[] = [];
  tr.forEach((v, i) => ATR.push(i < 13 ? Number.NaN : i === 13 ? tr.slice(0, 14).reduce((a, c) => a + c, 0) / 14 : (ATR[i - 1] * 13 + v) / 14));
  const ATRb = b.map((_, i) => med(prevWin(i).map(j => ATR[j])));
  const Vbar = b.map((_, i) => med(prevWin(i).map(j => Q[j])));
  const x = b.map((_, i) => (B[i] - S[i]) / Vbar[i]);
  const r = b.map((_, i) => (i ? (C[i] - C[i - 1]) / ATRb[i] : Number.NaN));
  const rho = b.map((_, i) => (i ? Math.log(C[i] / C[i - 1]) : Number.NaN));
  const rb = b.map((_, i) => (i ? Math.log(CB[i] / CB[i - 1]) : Number.NaN));
  const ws = (i: number, f: (j: number) => number, h: number, n: number) => { let s = 0, any = false; for (const j of win(i, n)) { const v = f(j); if (Number.isFinite(v)) { s += 2 ** (-(i - j) / h) * v; any = true; } } return any ? s : Number.NaN; };
  const flow = (h: number, n: number) => b.map((_, i) => ws(i, j => B[j] - S[j], h, n) / ws(i, j => Q[j], h, n));
  const F = flow(3, 12);
  const F6 = flow(2, 6), F24 = flow(6, 24);
  const dF = F6.map((v, i) => v - F24[i]);
  const lam0 = b.map((_, i) => sumF(win(i, BASE).map(j => r[j] * Math.sign(x[j]))) / sumF(win(i, BASE).map(j => Math.abs(x[j]))));
  const pos = (j: number, v: number) => (Number.isNaN(x[j]) ? Number.NaN : x[j] > 0 ? v : 0);
  const neg = (j: number, v: number) => (Number.isNaN(x[j]) ? Number.NaN : x[j] < 0 ? v : 0);
  const lam = (h: number, n: number, up: boolean) => b.map((_, i) => up
    ? (ws(i, j => pos(j, r[j]), h, n) + 0.5 * lam0[i]) / (ws(i, j => pos(j, x[j]), h, n) + 0.5)
    : (ws(i, j => neg(j, r[j]), h, n) - 0.5 * lam0[i]) / (ws(i, j => neg(j, x[j]), h, n) - 0.5));
  const lp = lam(6, 24, true), lm = lam(6, 24, false), lpf = lam(3, 12, true), lmf = lam(3, 12, false);
  const absorb = (a: number[], c: number[]) => a.map((v, i) => (v - c[i]) / (Math.abs(v) + Math.abs(c[i])));
  const A = absorb(lp, lm), Af = absorb(lpf, lmf);
  const e = b.map((_, i) => r[i] - (lp[i] * Math.max(x[i], 0) + lm[i] * Math.min(x[i], 0)));
  const U = b.map((_, i) => e[i] / sdS(prevWin(i).map(j => e[j])));
  const phi = b.map((_, i) => {
    const js = prevWin(i).filter(j => Number.isFinite(rho[j]) && Number.isFinite(rb[j]));
    if (js.length < 2) return Number.NaN;
    const mx = js.reduce((a, j) => a + rb[j], 0) / js.length, my = js.reduce((a, j) => a + rho[j], 0) / js.length;
    const cov = js.reduce((a, j) => a + (rb[j] - mx) * (rho[j] - my), 0), vx = js.reduce((a, j) => a + (rb[j] - mx) ** 2, 0);
    return vx > 0 ? cov / vx : Number.NaN;
  });
  const Mo = b.map((_, i) => sumF(win(i, 6).map(j => rho[j] - (Number.isFinite(phi[j] * rb[j]) ? phi[j] * rb[j] : 0))) / (ATR[i] / C[i] * Math.sqrt(6)));
  const M = b.map((_, i) => ws(i, j => Q[j] * ((H[j] + L[j] + C[j]) / 3), 6, 24) / ws(i, j => Q[j], 6, 24));
  const d = b.map((_, i) => (C[i] - M[i]) / ATR[i]);
  const v = b.map((_, i) => (i >= 6 ? (M[i] - M[i - 6]) / (6 * ATR[i]) : Number.NaN));
  const K = b.map((_, i) => { const hh = Math.max(...win(i, 12).map(j => H[j])), ll = Math.min(...win(i, 12).map(j => L[j])); return hh > ll ? (2 * C[i] - hh - ll) / (hh - ll) : 0; });
  const S6 = b.map((_, i) => sumF(win(i, 6).map(j => S[j])));
  const Ex = b.map((_, i) => Math.log(Math.max(...fins(win(i, 43).map(j => S6[j]))) / S6[i]));
  const DD = b.map((_, i) => (Math.max(...win(i, 48).map(j => C[j])) - C[i]) / ATR[i]);
  const rv = (n: number) => b.map((_, i) => sumF(win(i, n).map(j => Q[j])) / sumF(win(i, n).map(j => Vbar[j])));
  const RV = rv(12), RV24 = rv(24);
  const sig = (q: number) => 1 / (1 + Math.exp(-q));
  const clip = (z: number) => Math.min(3, Math.max(-3, z));
  const z = (s: number[], center = 0) => clip((s[t] - center) / rscale(prevWin(t).map(j => s[j])));
  const g = 2 * RV[t] ** 2 / (1 + RV[t] ** 2);
  const psi = sig(4 * (Math.log(RV24[t]) - Math.log(2.5))) * sig(2 * (DD[t] - 3));
  const L1 = g * (0.07 * z(F, med(prevWin(t).map(j => F[j]))) + 0.04 * z(dF) + 0.07 * z(A) + 0.07 * z(Mo) + 0.04 * z(d) + 0.04 * z(v) + 0.02 * z(K)) + 0.2 * Math.min(z(U), 0);
  const L2 = -0.5 + 0.35 * z(Af) + 0.25 * z(Ex);
  const p = (1 - psi) * sig(L1) + psi * sig(L2);
  return 2 * p - 1;
}

describe('【用户要求】CBI-2 买方优势指数第 2 版', () => {
  beforeEach(() => { resetBtcReference(); clearMarketDataCache(); });

  it('新函数：highest / lowest / msum / beta / clip 与笨办法一致', () => {
    const xs = Float64Array.from([3, Number.NaN, 7, 1, 5, 9, 2]);
    expect(Array.from(rollingExtreme(xs, 3, true))).toEqual([3, 3, 7, 7, 7, 9, 9]);
    expect(Array.from(rollingExtreme(xs, 3, false))).toEqual([3, 3, 3, 1, 1, 1, 2]);
    const run = (src: string, inputs: Record<string, Float64Array>) => evaluateProgram(parseFormula(src, new Set(Object.keys(inputs))), inputs, { barMinutes: 5 }) as Float64Array;
    expect(Array.from(run('msum(x, 3)', { x: xs }))).toEqual([3, 3, 10, 8, 13, 15, 16]);
    expect(Array.from(run('clip(x, 2, 6)', { x: xs })).map(v => (Number.isNaN(v) ? null : v))).toEqual([3, null, 6, 2, 5, 6, 2]);
    const xx = Float64Array.from([1, 2, 3, 4, 5]);
    const yy = Float64Array.from([2.5, 4.5, 6.5, 8.5, 10.5]);
    expect(rollingBeta(yy, xx, 5)[4]).toBeCloseTo(2, 12);
    expect(Number.isNaN(rollingBeta(yy, xx, 5)[0])).toBe(true);
  });

  it('computeCbi2（K 线图）与照笔记逐项直接算的结果一致（含缺成交额的 K 线）', () => {
    for (const missingEvery of [0, 47]) {
      const b = bars(700, 1, { missingEvery });
      const pts = computeCbi2(toCbi2(b));
      for (const t of [600, 699]) expect(pts[t].cbi2!).toBeCloseTo(cbi2ByDefinition(b, t), 9);
    }
  });

  it('取值在 −1 ~ 1；p、Ψ 在 0 ~ 1；剔除 BTC：币只跟着 BTC 走时 Mo ≈ 0，BTC 取不到时不剔除', () => {
    const pts = computeCbi2(toCbi2(bars(1000, 2))).filter(p => p.cbi2 != null);
    expect(pts.length).toBeGreaterThan(600);
    for (const p of pts) { expect(Math.abs(p.cbi2!)).toBeLessThan(1); expect(p.p!).toBeGreaterThan(0); expect(p.p!).toBeLessThan(1); expect(p.psi!).toBeGreaterThanOrEqual(0); expect(p.psi!).toBeLessThan(1); }
    const compiled = compileFeatureFormula(CBI2_FORMULA);
    expect(compiled.usesBtc).toBe(true);
    const follower = bars(700, 3, { beta: 1.5, own: 0 });
    const vars = computeFeatureValues(windowOf(follower), compiled, { avgHours: 24 }).vars;
    expect(vars.phi!).toBeCloseTo(1.5, 6);
    expect(Math.abs(vars.Mo!)).toBeLessThan(1e-6);
    const noBtc = computeFeatureValues(windowOf(bars(700, 3, { beta: 1.5, own: 0, noBtc: true })), compiled, { avgHours: 24 }).vars;
    expect(noBtc.phi).toBeNull();
    expect(Math.abs(noBtc.Mo!)).toBeGreaterThan(0.01);
  });

  it('Deep dig 内置特征值 CBI-2：公式结果与 K 线图一致；流水线另取同时段 BTCUSDT 合进来，别的特征值不取', async () => {
    expect(BUILTIN_FEATURES.at(-1)!.id).toBe(CBI2_DEF.id);
    const b = bars(700, 4);
    expect(computeFeatureValues(windowOf(b), compileFeatureFormula(CBI2_FORMULA), { avgHours: 24 }).value!).toBeCloseTo(computeCbi2(toCbi2(b)).at(-1)!.cbi2!, 9);
    // 模拟币安：两个币 + BTC，K 线带成交额
    const calls: string[] = [];
    const fetchFn: FetchFn = async url => {
      calls.push(url);
      const u = new URL(url);
      if (u.pathname.endsWith('/fundingRate')) return { ok: true, status: 200, json: async () => [] };
      const symbol = u.searchParams.get('symbol')!;
      const start = Number(u.searchParams.get('startTime')), end = Number(u.searchParams.get('endTime')), limit = Number(u.searchParams.get('limit'));
      const rows: unknown[] = [];
      for (let t = Math.ceil(start / BAR_MS) * BAR_MS; t <= end && rows.length < limit; t += BAR_MS) {
        const base = symbol === 'BTCUSDT' ? 60_000 : 100;
        const o = base * Math.exp(0.002 * Math.sin(t / (7 * BAR_MS) + symbol.length)), c = base * Math.exp(0.002 * Math.sin((t + BAR_MS) / (7 * BAR_MS) + symbol.length));
        const vol = 100 + 10 * Math.sin(t / (11 * BAR_MS));
        rows.push([t, String(o), String(Math.max(o, c) * 1.0005), String(Math.min(o, c) * 0.9995), String(c), String(vol), t + BAR_MS - 1, String(vol * c), 1, String(vol * 0.5), String(vol * c * (0.5 + 0.1 * Math.sin(t / (5 * BAR_MS)))), '0']);
      }
      return { ok: true, status: 200, json: async () => rows };
    };
    const T0 = Date.parse('2026-01-05T00:00:00Z');
    const rows: CampaignGroupRow[] = ['AAAUSDT', 'BBBUSDT'].map((symbol, i) => ({
      campaignId: `c${i}`, symbol, title: symbol, anchorMs: T0 + i * 3 * 86_400_000, theoreticalB: null, payoffRatio: null,
      grouping: { campaignId: `c${i}`, group: 'positive', theoreticalB: 'na', payoff: 'mid', positiveTriggered: false, controlTriggered: false, pendingReasons: [], excludedReasons: [] },
    }) as CampaignGroupRow);
    const report = { rows, counts: { positive: 0, control: 0, conflict: 0, middle: 0, pending: 0, excluded: 0 }, breakdown: { theoreticalB: { gt3: 0, lt05: 0, mid: 0, missing: 0, na: 0 }, payoff: { gt3: 0, lt05: 0, mid: 0, missing: 0, na: 0 } }, pendingReasons: {}, clusters: 0, conflictingClusters: 0 } as CampaignGroupReport;
    const { data } = await collectDeepDigRun(report, CBI2_DEF, { fetchFn, concurrency: 1, backgroundCap: 0 });
    expect(calls.some(u => u.includes('symbol=BTCUSDT'))).toBe(true);
    const withVars = data.rows.filter(r => r.vars?.phi != null);
    expect(withVars.length).toBeGreaterThan(0);
    calls.length = 0;
    clearMarketDataCache();
    await collectDeepDigRun(report, DRIFT_SPEED_DEF, { fetchFn, concurrency: 1, backgroundCap: 0 });
    expect(calls.some(u => u.includes('symbol=BTCUSDT'))).toBe(false);
  });
});

describe('【用户要求】K 线图指标菜单：CBI-2（副图）', () => {
  beforeEach(() => resetBtcReference());

  it('副图读 BTC 对照数据（按开盘时间对齐）；没有 BTC 时不剔除；取到新的 BTC 版本号变、通知图表重算', async () => {
    const b = bars(700, 6);
    const k: KLineData[] = b.map(x => ({ timestamp: x.openTime, open: x.open, high: x.high, low: x.low, close: x.close, volume: x.volume, turnover: x.quoteVolume!, takerBuyTurnover: x.takerBuyQuoteVolume } as KLineData));
    const without = cbi2Points(k, 24, { fetchReference: false });
    expect(without.at(-1)!.cbi2!).toBeCloseTo(computeCbi2(toCbi2(b).map(x => ({ ...x, refClose: null }))).at(-1)!.cbi2!, 12);
    const v0 = btcReferenceVersion();
    const listener = vi.fn();
    const off = subscribeBtcReference(listener);
    ingestBtcBars(BAR_MS, b.map(x => ({ openTime: x.openTime, close: x.refClose! })));
    expect(btcReferenceVersion()).toBe(v0 + 1);
    expect(listener).toHaveBeenCalledTimes(1);
    const withBtc = cbi2Points(k, 24, { fetchReference: false });
    expect(withBtc.at(-1)!.cbi2!).toBeCloseTo(computeCbi2(toCbi2(b)).at(-1)!.cbi2!, 12);
    expect(indicatorCalcParams('CBI2_CUSTOM', { period: 24 })).toEqual([24, btcReferenceVersion()]);
    // 按图上的时间段取 BTCUSDT：同一段只取一次
    const fetchFn = vi.fn<FetchFn>(async () => ({ ok: true, status: 200, json: async () => [] }));
    requestBtcReference(0, 10 * BAR_MS, BAR_MS, fetchFn);
    requestBtcReference(0, 10 * BAR_MS, BAR_MS, fetchFn);
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(2));
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(String(fetchFn.mock.calls[0][0])).toContain('symbol=BTCUSDT');
    requestBtcReference(0, 10 * BAR_MS, BAR_MS, fetchFn);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    off();
    expect(CUSTOM_INDICATOR_MAP.CBI2).toBe('CBI2_CUSTOM');
  });

  it('菜单里有 CBI-2：名称下面写定义，悬停给出计算步骤；参数默认基线 24 小时', () => {
    const onChange = vi.fn();
    render(<IndicatorMenu open indicators={[]} onIndicatorsChange={onChange} onClose={() => {}} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'CBI-2' } });
    expect(screen.getByText(/CBI-2 买方优势指数第 2 版（−1 ~ 1）= 2p − 1/)).toHaveAttribute('title', expect.stringContaining('Ψ = σ(4·(ln RV₂₄ − ln 2.5))·σ(2·(DD − 3))'));
    fireEvent.click(screen.getByText('买方优势指数 CBI-2'));
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ type: 'CBI2', period: 24, enabled: true })]);
  });
});
