import { describe, expect, it } from 'vitest';
import { BUILTIN_FEATURES, SELLER_CONTROL_DEF, checkDefinition, compileFeatureFormula, evaluateOnBars, isSellerFeature, mergeFeatureDefs } from '../features';
import { compileFishProgram, evaluateFishProgram } from '@/lib/fish/algorithm';
import { readFishPreference } from '@/lib/fish/preferences';
import { reconstructionDirection } from '@/lib/fish/reconstruction';
import { DOWNWARD_DRIFT_DEF, SELLER_PUSH_DEF } from './fixtures/retiredSellerFeatures';
import type { ResearchBar } from '@/lib/deepRsa/window';

// Same symmetric micro-volatility in every scenario; fixed drift starts after 400 neutral bars.
// This also keeps the legacy sd() denominator nonzero, so the comparison is meaningful.
function market(drift: number, share: number, noise = 0.0002): ResearchBar[] {
  let close = 100;
  return Array.from({ length: 1800 }, (_, i) => {
    const open = close;
    close *= Math.exp((i < 400 ? 0 : drift) + (i % 2 ? noise : -noise));
    const q = 10000, buyShare = i < 400 ? 0.5 : share;
    return { openTime: i * 300000, open, close, high: Math.max(open, close) * 1.0001, low: Math.min(open, close) / 1.0001,
      volume: q / close, quoteVolume: q, takerBuyQuoteVolume: q * buyShare, takerBuyVolume: null, refClose: null };
  });
}
const values = (def: typeof SELLER_PUSH_DEF, data: ResearchBar[]) => {
  const out = evaluateOnBars(data, compileFeatureFormula(def.formula));
  const x = out.vars.get(def.id === 'seller-push' ? 'bp' : def.id === 'seller-control' ? 'bc' : 'b')!;
  return Array.from(typeof x === 'number' ? data.map(() => x) : x);
};
const mean = (v: number[]) => v.slice(-200).reduce((s, x) => s + x, 0) / 200;
const scenarios = [market(-0.0008, 0.3), market(-0.0008, 0.7), market(0.0008, 0.3), market(0.0008, 0.7), market(0, 0.5)];

describe('DSP b 修正版：卖方主动推动与卖方控制力', () => {
  it('主动推动仅计主动卖出的下跌，任何情形均非正', () => {
    const all = scenarios.map(data => values(SELLER_PUSH_DEF, data)), [push, passiveDown, failedSell, buyUp, balanced] = all.map(mean);
    expect(push).toBeLessThan(-0.05);
    for (const x of [passiveDown, failedSell, buyUp, balanced]) expect(Math.abs(x)).toBeLessThan(Math.abs(push) * 0.01);
    for (const v of all) for (const x of v) expect(x).toBeLessThanOrEqual(0);
  });
  it('控制力对主动方对称：两种下跌等强为负，两种上涨等强为正，均衡接近零', () => {
    const [sellDown, buyDown, sellUp, buyUp, balanced] = scenarios.map(data => mean(values(SELLER_CONTROL_DEF, data)));
    expect(sellDown).toBeLessThan(-0.1); expect(buyDown).toBeLessThan(-0.1);
    expect(sellDown).toBeCloseTo(buyDown, 10);
    expect(sellUp).toBeGreaterThan(0.1); expect(buyUp).toBeGreaterThan(0.1);
    expect(sellUp).toBeCloseTo(buyUp, 10); expect(sellUp).toBeCloseTo(-sellDown, 6);
    expect(Math.abs(balanced)).toBeLessThan(Math.abs(sellDown) * 0.15);
  });
  it('保留原 DSP b 的矛盾作为对照：卖压失败的上涨被放大超过 1.2 倍', () => {
    const sellUp = mean(values(DOWNWARD_DRIFT_DEF, scenarios[2]));
    const buyUp = mean(values(DOWNWARD_DRIFT_DEF, scenarios[3]));
    expect(buyUp).toBeGreaterThan(0); expect(sellUp / buyUp).toBeGreaterThan(1.2);
    expect(sellUp / buyUp).toBeCloseTo(1.4, 10);
  });
  it('RMS 不减漂移：恒定非零收益仍然有限，Rz 在充分预热后为 ±1', () => {
    for (const drift of [-0.0008, 0.0008]) {
      const data = market(drift, 0.3, 0);
      for (const def of [SELLER_PUSH_DEF, SELLER_CONTROL_DEF]) {
        const out = evaluateOnBars(data, compileFeatureFormula(def.formula));
        const rz = out.vars.get('Rz') as Float64Array;
        expect(rz.at(-1)).toBeCloseTo(Math.sign(drift), 9);
        expect(values(def, data).every(Number.isFinite)).toBe(true);
      }
    }
  });
  it('内置顺序、定义、卖方符号版本和捕捞/复原方向正确，不凭空设置经验阈值', () => {
    const ids = BUILTIN_FEATURES.map(d => d.id), i = ids.indexOf(SELLER_CONTROL_DEF.id);
    expect(ids.slice(i - 1, i + 2)).toEqual(['cdi2', 'seller-control', 'dss']);
    expect(ids).not.toContain('seller-push');
    expect(ids).not.toContain('drift-speed-down-z');
    expect(ids.at(-1)).toBe('cda');
    for (const [def, core] of [[SELLER_CONTROL_DEF, 'bc']] as const) {
      expect(checkDefinition(def)).toEqual({ formula: null, groups: null, scale: null });
      expect(def).toMatchObject({ sellerSignVersion: 1, builtin: true, scale: 100, unit: '%σ/根' });
      expect(isSellerFeature(def.id)).toBe(true); expect(reconstructionDirection(def.id)).toBe('<');
      expect(readFishPreference(def.id)).toMatchObject({ direction: '<', sellerSignVersion: 1, threshold: '' });
      const program = compileFishProgram(def, { statistic: core, direction: '<', threshold: -0.01, constraints: [] });
      expect(program.unavailable).toBeUndefined();
      const result = evaluateFishProgram(scenarios[0], program);
      expect(result.condition.at(-1)).toBe(1);
      expect(mergeFeatureDefs([def]).find(d => d.id === def.id)?.formula).toBe(def.formula);
      const full = values(def, scenarios[0]);
      expect(values(def, scenarios[0].slice(0, 1600))).toEqual(full.slice(0, 1600));
    }
  });
});
