import { describe, expect, it } from 'vitest';
import { BUILTIN_FEATURES, DOWNWARD_DRIFT_DEF, DOWNWARD_DRIFT_FORMULA, DRIFT_SPEED_Z_DEF, DRIFT_SPEED_Z_FORMULA, checkDefinition, compileFeatureFormula, evaluateOnBars, featureWindowMs, mergeFeatureDefs } from '../features';
import type { ResearchBar } from '@/lib/deepRsa/window';

function bars(buyShare?: number): ResearchBar[] {
  let c = 100;
  return Array.from({ length: 620 }, (_, i) => {
    const open = c;
    c *= Math.exp(0.002 * Math.sin(i * 0.27) - 0.0004);
    const q = 10000 * (1.2 + 0.5 * Math.sin(i * 0.13));
    return { openTime: i * 300000, open, close: c, high: Math.max(c, open) * 1.001, low: Math.min(c, open) * 0.999,
      volume: q / c, quoteVolume: q, takerBuyVolume: null, takerBuyQuoteVolume: q * (buyShare ?? (0.5 + 0.3 * Math.sin(i * 0.19))), refClose: null };
  });
}
const run = (data: ResearchBar[], formula = DOWNWARD_DRIFT_FORMULA, params = {}) => evaluateOnBars(data, compileFeatureFormula(formula), params);
const get = (r: ReturnType<typeof run>, name: string, i: number) => {
  const v = r.vars.get(name)!;
  return typeof v === 'number' ? v : v[i];
};

describe('DSP·b 向下推动力量', () => {
  it('追加为下一项内置特征值；参数、观察窗、显示倍数和分组沿用 DSP·a 标准化版', () => {
    expect(BUILTIN_FEATURES.find(d => d.id === DOWNWARD_DRIFT_DEF.id)).toBe(DOWNWARD_DRIFT_DEF);
    expect(DOWNWARD_DRIFT_DEF).toMatchObject({ name: '向下推动力量', short: 'DSP·b', scale: 100, unit: '%σ/根' });
    expect(checkDefinition(DOWNWARD_DRIFT_DEF)).toEqual({ formula: null, groups: null, scale: null });
    for (const params of [{}, { interval: '15m' as const, halfLifeHours: 12, avgHours: 48 }]) {
      expect(featureWindowMs({ ...DOWNWARD_DRIFT_DEF, ...params })).toBe(featureWindowMs({ ...DRIFT_SPEED_Z_DEF, ...params }));
    }
    expect(mergeFeatureDefs([]).find(d => d.id === DRIFT_SPEED_Z_DEF.id)?.formula).toBe(DRIFT_SPEED_Z_FORMULA);
    const edited = { ...DOWNWARD_DRIFT_DEF, formula: DOWNWARD_DRIFT_FORMULA + '\navg_b = avg(b, 24)' };
    expect(mergeFeatureDefs([edited]).find(d => d.id === DOWNWARD_DRIFT_DEF.id)?.formula).toBe(edited.formula);
    expect(mergeFeatureDefs([{ ...DOWNWARD_DRIFT_DEF, removed: true }]).some(d => d.id === DOWNWARD_DRIFT_DEF.id)).toBe(false);
  });

  it('独立逐根手算成交强度、卖方权重、滚动样本标准差和 EMA', () => {
    const data = bars(), r = run(data);
    const returns = data.map((b, i) => i ? -Math.log(b.close / data[i - 1].close) : NaN);
    const rho = 2 ** (-5 / (6 * 60));
    let ema = 0;
    for (let i = 0; i < data.length; i++) {
      const q = data[i].quoteVolume!, buy = data[i].takerBuyQuoteVolume!, sell = q - buy;
      const window = data.slice(Math.max(0, i - 287), i + 1);
      const qAvg = window.reduce((n, b) => n + b.quoteVolume!, 0) / window.length;
      const rs = returns.slice(Math.max(0, i - 287), i + 1).filter(Number.isFinite);
      const mean = rs.reduce((n, v) => n + v, 0) / rs.length;
      const sd = Math.sqrt(rs.reduce((n, v) => n + (v - mean) ** 2, 0) / (rs.length - 1));
      const f = Math.log(1 + Math.abs(sell - buy) / qAvg);
      const g = 1 + Math.max((sell - buy) / q, 0);
      const force = rs.length >= 2 && sd > 0 ? f * g * returns[i] / sd : 0;
      ema = rho * ema + (1 - rho) * force;
      expect(get(r, 'F', i)).toBeCloseTo(force, 10);
      expect(get(r, 'b', i)).toBeCloseTo(-ema, 10);
    }
  });

  it('卖方占优时增强向下推力；最终输出上涨取正、下跌取负，不能直接用负的原 DSP·a', () => {
    const data = bars(0.2), seller = run(data), buyerDominant = run(bars(0.8));
    const original = run(data, DRIFT_SPEED_Z_FORMULA);
    for (let i = 10; i < data.length; i++) {
      const f = get(seller, 'F', i);
      expect(Math.sign(f)).toBe(Math.sign(data[i - 1].close - data[i].close));
      expect(Math.abs(f)).toBeCloseTo(1.6 * Math.abs(get(buyerDominant, 'F', i)), 10);
      expect(f).toBeCloseTo(-1.6 * get(original, 'F', i), 10);
    }
    const swapped = data.map(b => ({ ...b, takerBuyQuoteVolume: b.quoteVolume! - b.takerBuyQuoteVolume! }));
    const mirrored = run(swapped, DRIFT_SPEED_Z_FORMULA);
    for (let i = 10; i < data.length; i++) expect(get(seller, 'b', i)).toBeCloseTo(get(mirrored, 'az', i), 10);
  });

  it('缺成交读数沿用原算法记零推力；不补出额外成交，EMA 继续衰减', () => {
    const data = bars();
    data[500] = { ...data[500], takerBuyQuoteVolume: null };
    data[501] = { ...data[501], quoteVolume: null };
    const r = run(data), rho = 2 ** (-5 / 360);
    for (const i of [500, 501]) {
      expect(get(r, 'F', i)).toBe(0);
      expect(get(r, 'b', i)).toBeCloseTo(rho * get(r, 'b', i - 1), 12);
    }
  });

  it('原值及可选 24h 平均都不依赖未来数据', () => {
    const data = bars(), formula = DOWNWARD_DRIFT_FORMULA + '\navg_b = avg(b, 24)';
    const full = run(data, formula), prefix = run(data.slice(0, 500), formula);
    for (let i = 0; i < 500; i++) for (const key of ['b', 'avg_b']) expect(get(full, key, i)).toBe(get(prefix, key, i));
  });
});
