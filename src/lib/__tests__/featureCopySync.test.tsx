import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { KLineData } from 'klinecharts';
const native = vi.hoisted(() => new Map<string, any>());
vi.mock('klinecharts', () => ({ registerIndicator: (template: any) => native.set(template.name, template) }));
import { BUILTIN_FEATURES, MBI_DEF, CTBA_DEF, MBI_BEAR_DEF, CTBA_BEAR_DEF, STATE_DEF, FEATURES_KEY, copyFeatureDefinition, saveFeatureDefinition, compileFeatureFormula, evaluateOnBars, featureWindowMs } from '@/lib/deepDig/features';
import { accountFeatureDefs, chartFeatureSeries } from '@/lib/featureSource';
import { useFeatureDefinitions } from '@/hooks/useFeatureDefinitions';
import { useFishFeatures } from '@/hooks/useFishFeatures';
import { writePersistedStateRaw, clearPersistedStateMemoryForTests } from '@/lib/persistedStateStorage';
import { accountResearchIndicators, researchChartSeries, researchIndicatorForFeature, researchKcName, syncResearchIndicatorConfigs } from '@/lib/researchIndicators';
import { registerAccountFeatureIndicators, CUSTOM_INDICATOR_MAP, INDICATOR_COMPANIONS } from '@/lib/customIndicators';
import { fishStatistics, compileFishProgram } from '@/lib/fish/algorithm';

const key = 'sim_anon_' + FEATURES_KEY;
afterEach(() => { localStorage.clear(); clearPersistedStateMemoryForTests(); });
const bars = (count = 800) => Array.from({ length: count }, (_, i) => {
  const close = 100 * Math.exp(.04 * Math.sin(i / 22) + .0001 * i), amount = 10000 + 2000 * Math.cos(i / 9);
  return { openTime: i * 300000, open: close, high: close * 1.01, low: close * .99, close, volume: amount / close, quoteVolume: amount, takerBuyVolume: null, takerBuyQuoteVolume: amount * (.5 + .3 * Math.sin(i / 7)) };
});
const candles = (count = 800): KLineData[] => bars(count).map(b => ({ timestamp: b.openTime, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume, turnover: b.quoteVolume, takerBuyTurnover: b.takerBuyQuoteVolume }));

describe('independent feature definitions and live consumers', () => {
  it.each(BUILTIN_FEATURES)('$id copies every effective setting and never modifies the source', source => {
    const sourceWithParams = { ...source, halfLifeHours: 3, avgHours: 12, MBI_N: 7, MBI_Z0: .9 };
    const before = structuredClone(sourceWithParams), copy = copyFeatureDefinition(sourceWithParams, BUILTIN_FEATURES, 123);
    const second = copyFeatureDefinition(sourceWithParams, [...BUILTIN_FEATURES, copy], 123);
    expect(copy.id).not.toBe(source.id); expect(second.id).not.toBe(copy.id); expect(second.name).not.toBe(copy.name);
    expect(copy).toMatchObject({ formula: source.formula, halfLifeHours: 3, avgHours: 12, MBI_N: 7, MBI_Z0: .9, source: source.source });
    expect(copy.builtin).toBeUndefined();
    const saved = saveFeatureDefinition([sourceWithParams, copy], { ...copy, formula: 'x = C * 2', halfLifeHours: 1 });
    expect(saved.find(d => d.id === source.id)).toEqual(before);
    expect(sourceWithParams).toEqual(before);
    expect(featureWindowMs(copy)).toBe(featureWindowMs(sourceWithParams));
  });
  it('parameter-only saves immediately reach mounted fishing and account readers, including failed durable writes', async () => {
    const hook = renderHook(() => ({ account: useFeatureDefinitions(), fish: useFishFeatures() }));
    const next = saveFeatureDefinition([], { ...STATE_DEF, avgHours: 3, halfLifeHours: 2 });
    await act(async () => { writePersistedStateRaw(key, JSON.stringify(next)); await Promise.resolve(); });
    expect(hook.result.current.account.find(d => d.id === 'state')).toMatchObject({ avgHours: 3, halfLifeHours: 2, formula: STATE_DEF.formula });
    expect(hook.result.current.fish.find(d => d.id === 'state')).toMatchObject({ avgHours: 3, halfLifeHours: 2 });
    const failing = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
    await act(async () => { writePersistedStateRaw(key, JSON.stringify([{ ...STATE_DEF, avgHours: 9 }])); await Promise.resolve(); });
    expect(hook.result.current.fish.find(d => d.id === 'state')?.avgHours).toBe(9);
    failing.mockRestore(); hook.unmount();
  });
  it('copies have registered raw/avg/avg2 panes and fishing statistics driven by their own saved parameters', () => {
    const copy = { ...copyFeatureDefinition(MBI_DEF, BUILTIN_FEATURES, 202), MBI_N: 7, MBI_Z0: .8 };
    localStorage.setItem(key, JSON.stringify([copy]));
    const defs = accountFeatureDefs(), item = researchIndicatorForFeature(copy);
    registerAccountFeatureIndicators(defs);
    expect(CUSTOM_INDICATOR_MAP[item.id]).toBe(researchKcName(item.id));
    expect(INDICATOR_COMPANIONS[item.id]).toHaveLength(2);
    for (const level of [0, 1, 2]) expect(native.has(researchKcName(item.id, level))).toBe(true);
    const k = candles(), expected = evaluateOnBars(bars(), compileFeatureFormula(copy.formula), copy);
    const actual = researchChartSeries(k, item, 7, { fetchReference: false });
    expect(actual.core[34]).toBeNull(); expect(actual.core[35]).toBeCloseTo(expected.vars.get('MBI')![35], 12);
    const config = syncResearchIndicatorConfigs([{ type: item.id, period: 999, avgHours: 72 }], defs)[0];
    expect(config.period).toBe(7); expect(config.avgHours).toBe(24);
    const manual = syncResearchIndicatorConfigs([{ ...config, period: 11 }], defs)[0]; expect(manual.period).toBe(11);
    localStorage.setItem(key, JSON.stringify([{ ...copy, MBI_N: 9 }]));
    expect(syncResearchIndicatorConfigs([manual], accountFeatureDefs())[0].period).toBe(9);
    expect(chartFeatureSeries(k, 'mbi', 25)!.core.at(-1)).not.toBe(chartFeatureSeries(k, copy.id, 9)!.core.at(-1));
    const fish = renderHook(useFishFeatures);
    const def = fish.result.current.find(d => d.id === copy.id)!;
    expect(fishStatistics(def).map(s => s.name)).toEqual(expect.arrayContaining(['MBI', 'avg_MBI', 'avg_MBI_2']));
    expect(compileFishProgram(def, { statistic: 'MBI', direction: '<', threshold: -.5, constraints: [] }).unavailable).toBeFalsy();
    fish.unmount();
  });
  it.each([MBI_BEAR_DEF, CTBA_BEAR_DEF])('$id copies preserve the seller core, bounds and independent chart values', source => {
    const copy = copyFeatureDefinition(source, BUILTIN_FEATURES, 404);
    localStorage.setItem(key, JSON.stringify([copy]));
    const item = researchIndicatorForFeature(copy);
    expect(item).toMatchObject({ core: source.chartCore, seller: true }); expect(item.max).toBe(source.id==='mbi-bear'?1:100);
    expect(item.avgRange?.[1]).toBe(item.max);
    const actual = researchChartSeries(candles(1900), item, item.period, { fetchReference: false });
    const expected = evaluateOnBars(bars(1900), compileFeatureFormula(copy.formula), copy).vars.get(source.chartCore!) as Float64Array;
    expect(actual.core.at(-1)).toBeCloseTo(expected.at(-1)!, 10);
    expect(actual.core.some(v => v != null && v > 0)).toBe(true); expect(actual.core.some(v => v != null && v < 0)).toBe(true);
  });
  it('legacy CBI and CBA-2 chart selections reset saved parameters without duplicate menu entries', () => {
    const copies = BUILTIN_FEATURES.filter(d => ['cbi','cba-2'].includes(d.id)).map(d => ({ ...d, builtin: undefined, halfLifeHours: 3, formula: d.formula.replace(/^h\s*=\s*\d+/m,'h = 3') }));
    localStorage.setItem(key, JSON.stringify(copies));
    const defs = accountFeatureDefs();
    expect(accountResearchIndicators(defs).some(d => ['FEATURE_cbi','FEATURE_cba-2'].includes(d.id))).toBe(false);
    expect(syncResearchIndicatorConfigs([{type:'CBI', period:6}, {type:'CBA-2', period:6}], defs).map(c => c.period)).toEqual([3,3]);
  });
  it('anonymous and renamed formulas can still be displayed and averaged after saving', () => {
    const copy = { ...copyFeatureDefinition(CTBA_DEF, BUILTIN_FEATURES, 303), formula: 'ln(C / prev(C, 2))' };
    localStorage.setItem(key, JSON.stringify([copy]));
    const item = accountResearchIndicators().find(d => d.featureId === copy.id)!;
    const actual = researchChartSeries(candles(), item, item.period, { fetchReference: false });
    expect(actual.core.at(-1)).toBeCloseTo(Math.log(bars().at(-1)!.close / bars().at(-3)!.close), 12);
    expect(actual.avg2.at(-1)).not.toBeNull();
  });
});
