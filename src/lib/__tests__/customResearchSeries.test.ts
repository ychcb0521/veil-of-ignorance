import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KLineData } from 'klinecharts';
const mock = vi.hoisted(() => ({ registered: new Map<string, any>(), refs: [] as number[], version: 0, request: vi.fn() }));
vi.mock('klinecharts', () => ({ registerIndicator: (d: any) => mock.registered.set(d.name, d) }));
vi.mock('@/lib/btcReference', () => ({ btcClosesAt: (times: number[]) => times.map((_, i) => mock.refs[i] ?? null), requestBtcReference: mock.request, btcReferenceVersion: () => mock.version }));
import { CUSTOM_RESEARCH_INDICATORS, researchKcName, researchChartSeries, researchSeriesNames } from '@/lib/researchIndicators';
import { INDICATOR_COMPANIONS, CUSTOM_INDICATOR_MAP, indicatorCalcParams, registerCustomIndicators } from '@/lib/customIndicators';
import { BUILTIN_FEATURES, FEATURES_KEY, compileFeatureFormula, evaluateOnBars } from '@/lib/deepDig/features';
import type { ResearchBar } from '@/lib/deepRsa/window';
registerCustomIndicators();
beforeEach(() => { localStorage.clear(); mock.request.mockClear(); mock.version = 0; });
const saved = (defs: unknown[]) => localStorage.setItem('sim_anon_' + FEATURES_KEY, JSON.stringify(defs));
function data() {
  mock.refs = [];
  return Array.from({ length: 760 }, (_, i) => {
    const close = 100 + i / 50 + 2 * Math.sin(i / 9), q = 10000 + 3000 * Math.cos(i / 7);
    mock.refs.push(50000 + i * 2 + 300 * Math.sin(i / 15));
    return { timestamp: i * 300000, open: close - .1, high: close + 1, low: close - 1, close, volume: q / (close + .01), turnover: q, takerBuyTurnover: q * (.5 + .3 * Math.sin(i / 13)) } as KLineData;
  });
}
function bars(k: KLineData[]): ResearchBar[] { return k.map((d, i) => ({ openTime: d.timestamp, open: d.open, high: d.high, low: d.low, close: d.close, volume: d.volume!, quoteVolume: d.turnover!, takerBuyVolume: null, takerBuyQuoteVolume: d.takerBuyTurnover as number, refClose: mock.refs[i] })); }
const withAverages = (formula: string, x: string, hours = 24) => `${formula}\navg_${x} = avg(${x}, ${hours})\nm6 = avg(${x}, 6)\navg_${x}_2 = (4 * m6 + 3 * ago(m6, 6) + 2 * ago(m6, 12) + ago(m6, 18)) / 10`;
const values = (x: unknown, n: number, scale: number) => Array.from({ length: n }, (_, i) => { const v = typeof x === 'number' ? x : (x as Float64Array)?.[i]; return Number.isFinite(v) ? v * scale : null; });

describe('自制区十项的原值、avg_x、avg_x_2', () => {
  it.each(CUSTOM_RESEARCH_INDICATORS)('$id：三幅原生副图逐根等于 Deep dig，保存的均值优先，末尾表达式不能替代原值', item => {
    const k = data(), def = BUILTIN_FEATURES.find(d => d.id === item.featureId)!;
    const formula = withAverages(def.formula, item.core, 7) + `\nother = avg_${item.core}_2 * 99`;
    saved([{ ...def, formula, scale: def.scale * 2 }]);
    const expected = evaluateOnBars(bars(k), compileFeatureFormula(formula));
    const names = [CUSTOM_INDICATOR_MAP[item.id], ...(INDICATOR_COMPANIONS[item.id] ?? []).map(c => c.kcName)];
    expect(new Set(names)).toEqual(new Set([0, 1, 2].map(level => researchKcName(item.id, level))));
    for (const [level, variable] of [item.core, `avg_${item.core}`, `avg_${item.core}_2`].entries()) {
      const reg = mock.registered.get(researchKcName(item.id, level));
      const params = indicatorCalcParams(reg.name, { type: item.id, period: item.period, avgHours: 48 });
      const actual = reg.calc(k, { calcParams: params }).map((v: any) => v[reg.figures[0].key] ?? null);
      expect(actual).toEqual(values(expected.vars.get(variable), k.length, def.scale * 2));
      expect(actual.some((v: unknown) => v != null)).toBe(true);
      // 2026-10-22 用户要求：有固定范围的（状态 S、CDI2、DSS、CDA）均值副图纵轴固定，其余仍自动范围
      const fixed = ({ STATE: [0, 1], CDI2: [-1, 1], DSS: [-1, 1], CDA: [-100, 100] } as Record<string, [number, number]>)[item.id];
      if (level > 0) { expect(reg.minValue).toBe(fixed?.[0]); expect(reg.maxValue).toBe(fixed?.[1]); }
    }
    const prefix = researchChartSeries(k.slice(0, 620), item, item.period, { fetchReference: false });
    const full = researchChartSeries(k, item, item.period, { fetchReference: false });
    for (const key of ['core', 'avg', 'avg2'] as const) expect(prefix[key]).toEqual(full[key].slice(0, 620));
  });

  it.each(CUSTOM_RESEARCH_INDICATORS)('$id：未写均值时使用 24 小时及四个 6 小时段的 4:3:2:1，空值与 Deep dig 相同', item => {
    const k = data(), def = BUILTIN_FEATURES.find(d => d.id === item.featureId)!;
    const expected = evaluateOnBars(bars(k), compileFeatureFormula(withAverages(def.formula, item.core)));
    const actual = researchChartSeries(k, item, item.period, { fetchReference: false });
    for (const [key, name] of [['core', item.core], ['avg', `avg_${item.core}`], ['avg2', `avg_${item.core}_2`]] as const)
      expect(actual[key]).toEqual(values(expected.vars.get(name), k.length, def.scale));
    expect(actual.avg2[0]).toBeNull();
  });

  it('Z 定义使用 a / avg_a / avg_a_2 的账号也按原名读取，不把普通 DSP 或末尾均值当成原值', () => {
    const item = CUSTOM_RESEARCH_INDICATORS.find(i => i.id === 'DSP_Z')!, def = BUILTIN_FEATURES.find(d => d.id === item.featureId)!;
    const formula = 'a = C\navg_a = avg(a, 2)\navg_a_2 = avg(a, 1) * 3';
    saved([{ ...def, formula, scale: 2 }]); const k = data();
    expect(researchSeriesNames(item, formula)).toEqual({ core: 'a', avg: 'avg_a', avg2: 'avg_a_2' });
    const out = researchChartSeries(k, item, 6, { fetchReference: false });
    expect(out.core.at(-1)).toBe(k.at(-1)!.close * 2);
    expect(out.avg2.at(-1)).not.toBe(out.core.at(-1));
  });

  it('原五项也随账号公式、倍数、BTC 与原地 K 线变更而更新三条序列', () => {
    const item = CUSTOM_RESEARCH_INDICATORS.find(i => i.id === 'CBI2')!, def = BUILTIN_FEATURES.find(d => d.id === item.featureId)!;
    const formula = withAverages('CBI2 = CB + C', 'CBI2'); saved([{ ...def, formula }]);
    const k = data(), name = researchKcName(item.id), p = indicatorCalcParams(name, { period: 24 });
    const before = researchChartSeries(k, item, 24);
    expect(mock.request).toHaveBeenCalledWith(0, k.length * 300000, 300000);
    mock.refs = mock.refs.map(v => v + 1); mock.version++;
    const after = researchChartSeries(k, item, 24);
    expect(after.core.at(-1)).toBe(before.core.at(-1)! + 1);
    expect(indicatorCalcParams(name, { period: 24 })).not.toEqual(p);
    k.at(-1)!.close += 2;
    expect(researchChartSeries(k, item, 24).core.at(-1)).toBe(after.core.at(-1)! + 2);
    saved([{ ...def, formula, scale: 3 }]);
    expect(indicatorCalcParams(name, { period: 24 })).not.toEqual(p);
    expect(researchChartSeries(k, item, 24).core.at(-1)).toBe((after.core.at(-1)! + 2) * 3);
  });
});
