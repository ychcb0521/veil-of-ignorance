// 【用户要求】2026-10-22「在 Deep dig 里新加一个状态 0–1 特征值」：0 = 卖方完全占优，0.5 = 均衡，1 = 买方完全占优
import { describe, expect, it } from 'vitest';
import { BUILTIN_FEATURES, CDI2_DEF, CDI2_FORMULA, CBI2_FORMULA, STATE_DEF, STATE_FORMULA, checkDefinition, compileFeatureFormula, evaluateOnBars, mergeFeatureDefs } from '../features';
import type { ResearchBar } from '@/lib/deepRsa/window';

// drift：每根对数涨幅的趋势项；buy：主动买入占成交额的比例
function bars(drift: (i: number) => number, buy: (i: number) => number, n = 900): ResearchBar[] {
  let c = 100, btc = 50000;
  return Array.from({ length: n }, (_, i) => {
    const open = c;
    c *= Math.exp(drift(i) + 0.0015 * Math.sin(i * 0.37) + 0.001 * Math.cos(i * 0.91));
    btc *= Math.exp(0.0004 * Math.sin(i * 0.21));
    const q = 10000 * (1.6 + Math.sin(i * 0.13));
    return { openTime: i * 300000, open, high: Math.max(open, c) * 1.002, low: Math.min(open, c) * 0.998, close: c,
      volume: q / c, quoteVolume: q, takerBuyVolume: null, takerBuyQuoteVolume: q * buy(i), refClose: btc };
  });
}
const series = (formula: string, data: ResearchBar[], name: string) => { const v = evaluateOnBars(data, compileFeatureFormula(formula)).vars.get(name)!; return typeof v === 'number' ? data.map(() => v) : Array.from(v); };
const state = (data: ResearchBar[]) => series(STATE_FORMULA, data, 'state');
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('多空状态 S（0–1）', () => {
  it('内置特征值，排在 CDI2 前面；公式无错；结果是最后一句 state；可编辑、隐藏', () => {
    const i = BUILTIN_FEATURES.indexOf(STATE_DEF);
    expect(i).toBeGreaterThan(-1);expect(BUILTIN_FEATURES.find(d => d.id === 'cdi2')).toBe(CDI2_DEF);expect(BUILTIN_FEATURES[i + 1].id).toBe('state2');expect(BUILTIN_FEATURES[i + 2]).toBe(CDI2_DEF);
    expect(STATE_DEF).toMatchObject({ id: 'state', short: '状态', scale: 1 });
    expect(checkDefinition(STATE_DEF)).toEqual({ formula: null, groups: null, scale: null });
    expect(STATE_FORMULA.trim().split('\n').at(-1)).toMatch(/^state = /);
    expect(mergeFeatureDefs([{ ...STATE_DEF, removed: true }]).some(d => d.id === 'state')).toBe(false);
    expect(mergeFeatureDefs([]).find(d => d.id === 'state')?.formula).toBe(STATE_FORMULA);
  });
  it('买方分数 p 与 CBI-2 逐根一致，卖方分数 ps 与 CDI2 逐根一致', () => {
    const data = bars(i => 0.0002 * Math.sin(i / 90), i => 0.5 + 0.25 * Math.sin(i * 0.17));
    const p = series(STATE_FORMULA, data, 'p'), ps = series(STATE_FORMULA, data, 'ps');
    const cbi = series(CBI2_FORMULA, data, 'p'), cdi = series(CDI2_FORMULA, data, 'p');
    let checked = 0;
    for (let i = 400; i < data.length; i++) { expect(p[i]).toBeCloseTo(cbi[i], 10); expect(ps[i]).toBeCloseTo(cdi[i], 10); checked++; }
    expect(checked).toBe(500);
  });
  it('落在 0 ~ 1：买方主导的上涨读数高，卖方主导的下跌读数低，均衡震荡在 0.5 附近', () => {
    const up = state(bars(i => i > 500 ? 0.0012 : 0, i => i > 500 ? 0.68 : 0.5)).slice(-150);
    const down = state(bars(i => i > 500 ? -0.0012 : 0, i => i > 500 ? 0.32 : 0.5)).slice(-150);
    const flat = state(bars(() => 0, i => 0.5 + 0.05 * Math.sin(i * 0.17))).slice(-300);
    for (const v of [...up, ...down, ...flat]) { expect(v).toBeGreaterThan(0); expect(v).toBeLessThan(1); }
    expect(mean(up)).toBeGreaterThan(0.75);
    expect(mean(down)).toBeLessThan(0.25);
    expect(Math.abs(mean(flat) - 0.5)).toBeLessThan(0.12);
    // 大致对称：上涨离 1 的距离与下跌离 0 的距离同一量级
    expect(Math.abs((1 - mean(up)) - mean(down))).toBeLessThan(0.12);
  });
});
describe('多空状态 S 在「渔」里可用', () => {
  it('能编成捕捞算法（所需历史不超上限），阈值按 0 ~ 1 填', async () => {
    const { compileFishProgram } = await import('@/lib/fish/algorithm');
    const plan = compileFishProgram(STATE_DEF, { direction: '>', threshold: 0.7, constraints: [] } as any);
    expect(plan.unavailable).toBeFalsy();expect(plan.N).toBeLessThanOrEqual(5000);
  });
});
