import { describe, expect, it } from 'vitest';
import { CBI2_FORMULA, CDI2_DEF, CDI2_FORMULA, BUILTIN_FEATURES, checkDefinition, compileFeatureFormula, evaluateOnBars, definitionKey, mergeFeatureDefs } from '../features';
import type { ResearchBar } from '@/lib/deepRsa/window';

function bars(): ResearchBar[] {
  let c = 100, btc = 50000;
  return Array.from({ length: 760 }, (_, i) => {
    const open = c;
    c *= Math.exp(0.001 * Math.sin(i * 0.37) + 0.0008 * Math.cos(i * 0.11) + (i > 600 ? -0.001 : 0.0001));
    btc *= Math.exp(0.0004 * Math.sin(i * 0.21));
    const q = 10000 * (1.6 + Math.sin(i * 0.13)) * (i > 650 ? 3 : 1);
    return { openTime: i * 300000, open, high: Math.max(open, c) * 1.002, low: Math.min(open, c) * 0.998, close: c,
      volume: q / c, quoteVolume: q, takerBuyVolume: null, takerBuyQuoteVolume: q * (i > 600 ? 0.15 + 0.05 * Math.sin(i) : 0.5 + 0.3 * Math.sin(i * 0.17)), refClose: btc };
  });
}
const run = (formula: string, data = bars()) => evaluateOnBars(data, compileFeatureFormula(formula));
const at = (vars: ReturnType<typeof run>['vars'], name: string, i: number): number => {
  const v = vars.get(name)!;
  return typeof v === 'number' ? v : v[i];
};
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

describe('CDI2 买方失控程度', () => {
  it('作为下一项内置特征值，支持独立编辑、隐藏、恢复；原 CBI-2 定义不变', () => {
    expect(BUILTIN_FEATURES.at(-1)).toBe(CDI2_DEF);
    expect(CDI2_DEF).toMatchObject({ id: 'cdi2', name: '买方失控程度', short: 'CDI2', scale: 1 });
    expect(checkDefinition(CDI2_DEF)).toEqual({ formula: null, groups: null, scale: null });
    expect(compileFeatureFormula(CDI2_FORMULA).program.inputs.has('CB')).toBe(true);
    const edited = { ...CDI2_DEF, formula: CDI2_FORMULA + '\navg_CDI2 = avg(CDI2, 24)' };
    expect(mergeFeatureDefs([edited]).find(d => d.id === 'cdi2')?.formula).toBe(edited.formula);
    expect(definitionKey(edited)).not.toBe(definitionKey(CDI2_DEF));
    expect(mergeFeatureDefs([{ ...CDI2_DEF, removed: true }]).some(d => d.id === 'cdi2')).toBe(false);
    expect(mergeFeatureDefs([]).find(d => d.id === 'cbi2')?.formula).toBe(CBI2_FORMULA);
  });

  it('逐根核对全部方向项、买卖冲击斜率与 BTC 剔除，尺度、窗口和参与度保持一致', () => {
    const b = run(CBI2_FORMULA).vars, s = run(CDI2_FORMULA).vars;
    let checked = 0;
    for (let i = 350; i < 760; i++) {
      for (const key of ['x', 'r', 'rho', 'rb', 'F', 'dF', 'A', 'Af', 'e', 'U', 'Mo', 'd', 'v', 'K']) {
        expect(at(s, key, i), `${key}@${i}`).toBeCloseTo(-at(b, key, i), 8);
      }
      for (const key of ['ATR', 'ATRb', 'Vbar', 'M', 'lam0', 'phi', 'RV', 'RV24', 'g']) {
        expect(at(s, key, i), `${key}@${i}`).toBeCloseTo(at(b, key, i), 8);
      }
      expect(at(s, 'lp', i)).toBeCloseTo(at(b, 'lm', i), 8);
      expect(at(s, 'lm', i)).toBeCloseTo(at(b, 'lp', i), 8);
      checked++;
    }
    expect(checked).toBe(410);
  });

  it('极端分支取买盘衰竭和上冲；独立手算顺势、吸收、混合分数，不能直接取负 CBI2', () => {
    const data = bars(), s = run(CDI2_FORMULA, data).vars, b = run(CBI2_FORMULA, data).vars;
    let difference = 0;
    for (let i = 350; i < data.length; i++) {
      const read = (k: string) => at(s, k, i);
      const buy6 = (j: number) => data.slice(j - 5, j + 1).reduce((n, r) => n + r.takerBuyQuoteVolume!, 0);
      const ex = Math.log(Math.max(...Array.from({ length: 43 }, (_, j) => buy6(i - j))) / buy6(i));
      expect(read('Ex')).toBeCloseTo(ex, 9);
      const du = (data[i].close - Math.min(...data.slice(i - 47, i + 1).map(r => r.close))) / read('ATR');
      expect(read('DU')).toBeCloseTo(du, 9);
      const psi = sigmoid(4 * (Math.log(read('RV24')) - Math.log(2.5))) * sigmoid(2 * (du - 3));
      expect(read('Psi')).toBeCloseTo(psi, 12);
      const l1 = read('g') * (0.07 * read('zF') + 0.04 * read('zdF') + 0.07 * read('zA') + 0.07 * read('zMo') + 0.04 * read('zd') + 0.04 * read('zv') + 0.02 * read('zK')) + 0.2 * Math.min(read('zU'), 0);
      const l2 = -0.5 + 0.35 * read('zAf') + 0.25 * read('zEx');
      expect(read('L1')).toBeCloseTo(l1, 12);
      expect(read('L2')).toBeCloseTo(l2, 12);
      const expected = 2 * ((1 - psi) * sigmoid(l1) + psi * sigmoid(l2)) - 1;
      expect(read('CDI2')).toBeCloseTo(expected, 12);
      expect(read('CDI2')).toBeGreaterThanOrEqual(-1);
      expect(read('CDI2')).toBeLessThanOrEqual(1);
      difference = Math.max(difference, Math.abs(read('CDI2') + at(b, 'CBI2', i)));
    }
    expect(difference).toBeGreaterThan(0.001);
    expect(at(s, 'CDI2', 759)).toBeGreaterThan(at(b, 'CBI2', 759));
  });

  it('计算不依赖未来；缺 BTC 时沿用 CBI2 的降级处理，24h 平均可直接选用', () => {
    const data = bars().map(b => ({ ...b, refClose: null }));
    const formula = CDI2_FORMULA + '\navg_CDI2 = avg(CDI2, 24)';
    const a = run(formula, data.slice(0, 650)).vars, b = run(formula, data).vars;
    for (let i = 350; i < 650; i++) {
      expect(at(a, 'CDI2', i)).toBe(at(b, 'CDI2', i));
      expect(at(a, 'avg_CDI2', i)).toBe(at(b, 'avg_CDI2', i));
      expect(Number.isFinite(at(a, 'CDI2', i))).toBe(true);
    }
  });
});
