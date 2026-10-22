import { describe, expect, it } from 'vitest';
import { BUILTIN_FEATURES, CBA_DEF, CBA_FORMULA, CDA_DEF, CDA_FORMULA, checkDefinition, compileFeatureFormula, evaluateOnBars, featureWindowMs, mergeFeatureDefs } from '../features';
import type { ResearchBar } from '@/lib/deepRsa/window';
function bars(buyShare?: number): ResearchBar[] {
  let c = 100;
  return Array.from({ length: 820 }, (_, i) => {
    const open = c;
    c *= Math.exp(0.002 * Math.sin(i * 0.27) + (i > 600 ? -0.0008 : 0.0003));
    const q = 10000 * (1.3 + 0.2 * Math.sin(i * 0.19));
    const e = c * (1 + 0.002 * Math.sin(i * 0.31));
    return { openTime: i * 300000, open, close: c, high: Math.max(c, open) * 1.003, low: Math.min(c, open) * 0.997,
      volume: q / e, quoteVolume: q, takerBuyVolume: null, takerBuyQuoteVolume: q * (buyShare ?? (0.5 + 0.3 * Math.sin(i * 0.23))), refClose: null };
  });
}
const run = (data: ResearchBar[], formula = CDA_FORMULA, params = {}) => evaluateOnBars(data, compileFeatureFormula(formula), params);
const at = (r: ReturnType<typeof run>, k: string, i: number) => { const v = r.vars.get(k)!; return typeof v === 'number' ? v : v[i]; };
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]) => { const m = mean(xs); return Math.sqrt(xs.reduce((n, v) => n + (v - m) ** 2, 0) / (xs.length - 1)); };
function manual(data: ResearchBar[], t: number, minutes: number) {
  const n = 24 * 60 / minutes, count = Math.min(48 * 60 / minutes, t + 1), rho = 2 ** (-minutes / 360);
  const e = data.map(b => b.quoteVolume! / b.volume!);
  const sigma = sd(e.slice(Math.max(1, t - n), t).map((v, j) => Math.log(v / e[Math.max(1, t - n) + j - 1])));
  let sum = 0, weights = 0;
  for (let k = 0; k < count; k++) {
    const i = t - k, w = rho ** k;
    weights += w;
    if (i === 0 || !Number.isFinite(data[i].takerBuyQuoteVolume)) continue;
    const q = data[i].quoteVolume!, d = q - 2 * data[i].takerBuyQuoteVolume!;
    const vbar = mean(data.slice(Math.max(0, i - n), i).map(b => b.quoteVolume!));
    const f = Math.log(1 + (Math.abs(d) + 0.5 * (q - Math.abs(d))) / vbar), g = 1 + Math.max(d / q, 0);
    sum += w * f * g * Math.log(e[i - 1] / Math.max(e[t], data[t].close)) / (k + 1);
  }
  return 100 * Math.tanh(sum / weights / sigma);
}

describe('CDA 买方阻力', () => {
  it('追加独立特征值，可编辑与隐藏；CBA 原定义及窗口、参数和显示尺度保留', () => {
    expect(BUILTIN_FEATURES.at(-1)).toBe(CDA_DEF);
    expect(CDA_DEF).toMatchObject({ name: '买方阻力', short: 'CDA', scale: 1, unit: '' });
    expect(checkDefinition(CDA_DEF)).toEqual({ formula: null, groups: null, scale: null });
    for (const params of [{}, { interval: '15m' as const, avgHours: 48, halfLifeHours: 12 }]) expect(featureWindowMs({ ...CDA_DEF, ...params })).toBe(featureWindowMs({ ...CBA_DEF, ...params }));
    const edited = { ...CDA_DEF, formula: CDA_FORMULA + '\navg_CDA = avg(CDA, 24)' };
    expect(mergeFeatureDefs([edited]).find(d => d.id === 'cda')?.formula).toBe(edited.formula);
    expect(mergeFeatureDefs([{ ...CDA_DEF, removed: true }]).some(d => d.id === 'cda')).toBe(false);
    expect(mergeFeatureDefs([]).find(d => d.id === 'cba')?.formula).toBe(CBA_FORMULA);
  });
  it.each([5, 15])('逐项独立手算 %s 分钟周期的 48h 保留下移、时间归一化及上一根波动率', minutes => {
    const data = bars().map((b, i) => ({ ...b, openTime: i * minutes * 60000 }));
    data[450] = { ...data[450], takerBuyQuoteVolume: null };
    const r = run(data, CDA_FORMULA, { interval: minutes === 5 ? '5m' : '15m' });
    for (const t of [310, 575, 619, 819]) expect(at(r, 'CDA', t)).toBeCloseTo(manual(data, t, minutes), 8);
  });
  it('卖方失衡加权、当前价取高；尺度与成交支持一致，不能直接取负 CBA', () => {
    const data = bars(0.2), s = run(data), b = run(data, CBA_FORMULA);
    for (let i = 300; i < data.length; i++) {
      expect(at(s, 'D', i)).toBeCloseTo(-at(b, 'D', i), 10);
      expect(at(s, 'F', i)).toBeCloseTo(at(b, 'F', i), 12);
      expect(at(s, 'sig', i)).toBeCloseTo(at(b, 'sig', i), 12);
      expect(at(s, 'G', i)).toBeCloseTo(1.6, 12);
      expect(at(s, 'P', i)).toBe(Math.max(data[i].quoteVolume! / data[i].volume!, data[i].close));
      expect(Math.abs(at(s, 'CDA', i))).toBeLessThanOrEqual(100);
    }
    expect(at(s, 'CDA', 819)).toBeGreaterThan(0);
    expect(Math.abs(at(s, 'CDA', 819) + at(b, 'CBA', 819))).toBeGreaterThan(0.01);
  });
  it('当前成交均价缺失沿用 CBA 的空值处理；原值和 24h 平均只用当时及之前的数据', () => {
    const data = bars(); data[500] = { ...data[500], volume: null };
    const f = CDA_FORMULA + '\navg_CDA = avg(CDA, 24)';
    const full = run(data, f), prefix = run(data.slice(0, 700), f);
    expect(Number.isNaN(at(full, 'CDA', 500))).toBe(true);
    for (let i = 300; i < 700; i++) for (const key of ['CDA', 'avg_CDA']) expect(at(full, key, i)).toBe(at(prefix, key, i));
  });
});
