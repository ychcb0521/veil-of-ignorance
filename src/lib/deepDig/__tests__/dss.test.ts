import { describe, expect, it } from 'vitest';
import { BSS_DEF, BSS_FORMULA, BUILTIN_FEATURES, DSS_DEF, DSS_FORMULA, checkDefinition, compileFeatureFormula, evaluateOnBars, featureWindowMs, mergeFeatureDefs } from '../features';
import type { ResearchBar } from '@/lib/deepRsa/window';

function bars(direction?: number, volume?: number): ResearchBar[] {
  let c = 100;
  return Array.from({ length: 620 }, (_, i) => {
    const open = c;
    const drift = i > 590 && direction ? direction * 0.0015 : 0.001 * Math.sin(i * 0.27) + 0.0005 * Math.cos(i * 0.17);
    c *= Math.exp(drift);
    const q = 10000 * (1.3 + 0.2 * Math.sin(i * 0.19)) * (i > 590 ? (volume ?? 1) : 1);
    return { openTime: i * 300000, open, close: c, high: Math.max(c, open) * 1.001, low: Math.min(c, open) * 0.999,
      volume: q / c, quoteVolume: q, takerBuyVolume: null, takerBuyQuoteVolume: q * (0.5 + 0.35 * Math.sin(i * 0.23)), refClose: null };
  });
}
const run = (data: ResearchBar[], formula = DSS_FORMULA) => evaluateOnBars(data, compileFeatureFormula(formula));
const at = (r: ReturnType<typeof run>, key: string, i: number) => { const v = r.vars.get(key)!; return typeof v === 'number' ? v : v[i]; };
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const z = (xs: number[]) => { const m = mean(xs); return (xs.at(-1)! - m) / Math.sqrt(xs.reduce((n, v) => n + (v - m) ** 2, 0) / (xs.length - 1)); };

describe('DSS 买方状态恶化', () => {
  it('追加到目录，沿用 BSS 的参数与观察窗；可独立编辑、隐藏，不升级或改写原 BSS', () => {
    expect(BUILTIN_FEATURES.at(-1)).toBe(DSS_DEF);
    expect(DSS_DEF).toMatchObject({ id: 'dss', name: '买方状态恶化', short: 'DSS', scale: 1, unit: '' });
    expect(checkDefinition(DSS_DEF)).toEqual({ formula: null, groups: null, scale: null });
    for (const params of [{}, { interval: '15m' as const, avgHours: 48 }]) expect(featureWindowMs({ ...DSS_DEF, ...params })).toBe(featureWindowMs({ ...BSS_DEF, ...params }));
    const edited = { ...DSS_DEF, formula: DSS_FORMULA + '\navg_DSS = avg(DSS, 24)' };
    expect(mergeFeatureDefs([edited]).find(d => d.id === 'dss')?.formula).toBe(edited.formula);
    expect(mergeFeatureDefs([{ ...DSS_DEF, removed: true }]).some(d => d.id === 'dss')).toBe(false);
    expect(mergeFeatureDefs([]).find(d => d.id === 'bss')?.formula).toBe(BSS_FORMULA);
  });

  it('独立逐根手算 1h 动量、成交额、主动卖方失衡与 24h 样本标准化及加权总分', () => {
    const data = bars(), r = run(data);
    const m = data.map((b, i) => i >= 12 ? 1 - b.close / data[i - 12].close : NaN);
    const v = data.map((_, i) => mean(data.slice(Math.max(0, i - 11), i + 1).map(b => b.quoteVolume!)) / mean(data.slice(Math.max(0, i - 287), i + 1).map(b => b.quoteVolume!)));
    for (let i = 310; i < data.length; i++) {
      const recent = data.slice(i - 11, i + 1);
      const a = (mean(recent.map(b => b.quoteVolume! - b.takerBuyQuoteVolume!)) - mean(recent.map(b => b.takerBuyQuoteVolume!))) / mean(recent.map(b => b.quoteVolume!));
      const mz = Math.tanh(z(m.slice(i - 287, i + 1))), vz = Math.tanh(z(v.slice(i - 287, i + 1)));
      const vd = m[i] > 0 ? vz : m[i] < 0 ? Math.min(-vz, 0) : 0;
      expect(at(r, 'M', i)).toBeCloseTo(m[i], 12);
      expect(at(r, 'A', i)).toBeCloseTo(a, 12);
      expect(at(r, 'DSS', i)).toBeCloseTo(0.45 * mz + 0.25 * vd + 0.30 * a, 9);
      expect(Math.abs(at(r, 'DSS', i))).toBeLessThanOrEqual(1);
    }
  });

  it.each([[-1, 5, 1], [-1, 0.1, -1], [1, 5, -1], [1, 0.1, 0]])('价格方向 %s、相对成交变化 %s：方向量分符号为 %s', (direction, volume, sign) => {
    const r = run(bars(direction, volume));
    expect(Math.sign(at(r, 'Vd', 619))).toBe(sign);
  });

  it('动量和主动失衡逐根镜像；成交量非对称规则也转换，不能只取负 BSS', () => {
    const data = bars(-1, 0.1), seller = run(data), buyer = run(data, BSS_FORMULA);
    for (let i = 310; i < data.length; i++) {
      for (const key of ['M', 'Mz', 'A']) expect(at(seller, key, i)).toBeCloseTo(-at(buyer, key, i), 9);
      expect(at(seller, 'V', i)).toBeCloseTo(at(buyer, 'V', i), 12);
    }
    expect(Math.abs(at(seller, 'DSS', 619) + at(buyer, 'BSS', 619))).toBeGreaterThan(0.01);
  });

  it('按原 BSS 口径保留缺值；原值与可选 24h 平均不依赖未来', () => {
    const data = bars(); data[500] = { ...data[500], close: NaN };
    const formula = DSS_FORMULA + '\navg_DSS = avg(DSS, 24)';
    const full = run(data, formula), prefix = run(data.slice(0, 550), formula);
    expect(Number.isNaN(at(full, 'DSS', 500))).toBe(true);
    for (let i = 310; i < 550; i++) for (const key of ['DSS', 'avg_DSS']) expect(at(prefix, key, i)).toBe(at(full, key, i));
  });
});
