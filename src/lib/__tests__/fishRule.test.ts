import { beforeEach, describe, expect, it } from 'vitest';
import type { KLineData } from 'klinecharts';
import { BUILTIN_FEATURES, CBI2_DEF, compileFeatureFormula, FEATURES_KEY, DRIFT_SPEED_DEF } from '@/lib/deepDig/features';
import { compileFishProgram, evaluateFishProgram } from '@/lib/fish/algorithm';
import { fishResultName, fishRuleText } from '@/lib/fishRule';
import { chartFeatureSeries, featureCoreName, sameCoreAsBuiltin } from '@/lib/featureSource';
import { cbi2Points, unifiedDspA } from '@/lib/customIndicators';
import type { ResearchBar } from '@/lib/deepRsa/window';

const WITH_AVG = { ...CBI2_DEF, formula: `${CBI2_DEF.formula}\navg_CBI2 = avg(CBI2, 24)` };
const core = (formula: string) => featureCoreName(compileFeatureFormula(formula).program);

function klines(n = 1500): KLineData[] {
  let s = 7, p = 1; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  return Array.from({ length: n }, (_, i) => { const o = p; p *= Math.exp((rnd() - 0.5) * 0.01); const q = 1e5 * (0.5 + rnd()); return { timestamp: Date.UTC(2026, 3, 1) + i * 300000, open: o, high: Math.max(o, p) * 1.001, low: Math.min(o, p) * 0.999, close: p, volume: q / p, turnover: q, takerBuyTurnover: q * (0.3 + 0.4 * rnd()) } as KLineData; });
}

describe('【用户要求】2026-10-19 公式统一：K 线图、渔、Deep dig 读同一份定义，avg 只套一次', () => {
  beforeEach(() => localStorage.clear());

  it('核心值：末尾的纯均值行不算（可连着几层）；只对前面起过名的变量取均值才算纯均值行；内置公式不受影响', () => {
    expect(core(CBI2_DEF.formula)).toBe('CBI2');
    expect(core(WITH_AVG.formula)).toBe('CBI2');
    expect(core('x = C\na = avg(x, 24)\nb = avg(a, 12)')).toBe('x');
    expect(core('x = avg(C, 24)')).toBe('x');
    expect(core('x = C\ny = avg(x, 24) - x')).toBe('y');
    for (const d of BUILTIN_FEATURES) expect(core(d.formula)).toBe(compileFeatureFormula(d.formula).program.statements.at(-1)!.name);
  });

  it('渔：定义末尾加了 avg 行，仍是 avg(CBI2, H)——不重复取均值；所需根数、读数与内置完全相同；规则文字写 CBI2', () => {
    const a = compileFishProgram(CBI2_DEF, { H: 24, direction: '>', threshold: 0.07, constraints: [] });
    const b = compileFishProgram(WITH_AVG, { H: 24, direction: '>', threshold: 0.07, constraints: [] });
    expect(b.resultName).toBe('CBI2');
    expect(b.N).toBe(a.N);
    const bars: ResearchBar[] = klines(a.N).map(k => ({ openTime: k.timestamp, open: k.open, high: k.high, low: k.low, close: k.close, volume: k.volume!, takerBuyVolume: null, quoteVolume: k.turnover!, takerBuyQuoteVolume: k.takerBuyTurnover as number, refClose: 1 }));
    const ra = evaluateFishProgram(bars, a), rb = evaluateFishProgram(bars, b);
    expect(Array.from(rb.average)).toEqual(Array.from(ra.average));
    expect(fishResultName(WITH_AVG)).toBe('CBI2');
    expect(fishRuleText(WITH_AVG, 24, '>', 0.07)).toBe('avg(CBI2, 24h) > 0.07');
  });

  it('核心公式相同的判定：只改注释、末尾加均值行都算相同；改了核心公式算不同', () => {
    expect(sameCoreAsBuiltin(WITH_AVG, CBI2_DEF)).toBe(true);
    expect(sameCoreAsBuiltin({ ...CBI2_DEF, formula: CBI2_DEF.formula.replace('# 参与度敏感度', '# 注释') }, CBI2_DEF)).toBe(true);
    expect(sameCoreAsBuiltin({ ...CBI2_DEF, formula: CBI2_DEF.formula.replace('k = 2 ', 'k = 3 ') }, CBI2_DEF)).toBe(false);
  });

  it('K 线图跟着 Deep dig 的定义走：没改核心 → 与原实现逐位相同；改了核心 → 图上按改过的公式算；DSP 的 a 按 Deep dig 公式', () => {
    const data = klines();
    localStorage.setItem('sim_anon_' + FEATURES_KEY, JSON.stringify([WITH_AVG]));
    expect(chartFeatureSeries(data, 'cbi2', 24, data.map(() => null))!.core).toEqual(cbi2Points(data, 24, { fetchReference: false }).map(p => p.cbi2));
    const edited = { ...CBI2_DEF, formula: CBI2_DEF.formula.replace('k = 2 ', 'k = 3 ') };
    localStorage.setItem('sim_anon_' + FEATURES_KEY, JSON.stringify([edited]));
    const after = chartFeatureSeries(data, 'cbi2', 24, data.map(() => null))!.core;
    expect(after).not.toEqual(cbi2Points(data, 24, { fetchReference: false }).map(p => p.cbi2));
    localStorage.clear();
    const dsp = chartFeatureSeries(data, 'drift-speed', 6)!;
    expect(unifiedDspA(data, 6, false)).toEqual(dsp.core.map(v => (v == null ? null : v * DRIFT_SPEED_DEF.scale)));
  });
});
