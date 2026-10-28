import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { BUILTIN_FEATURES, CBI2_DEF, compileFeatureFormula, computeFeatureValues, definitionKey, evaluateOnBars, featureWindowMs, formulaVariables, MBI_DEF, mergeFeatureDefs, DEFAULT_GROUPS, compileGroups, signalSample, classifySample, checkDefinition } from '../features';
import { computeMbi } from '@/lib/mbi';
import { extractWindow } from '@/lib/deepRsa/window';
import { computeEventSeries } from '../series';
import { createFormulaEvaluationCache, lastValue, rollingMean } from '../formula';
import { snapshotOf, viewForVariable } from '../analysis';
import { runInference } from '../commands';
import { makeData } from './fixtures';
import { mbiBars } from './fixtures/mbiBars';
import baseline from './fixtures/mbiLegacyBaseline.json';
import { appendResearchAverages } from '@/lib/researchAverageFormula';
import { CUSTOM_RESEARCH_INDICATORS, researchChartFormula, researchChartSeries } from '@/lib/researchIndicators';
import { compileFishProgram, fishStatistics } from '@/lib/fish/algorithm';
import { fishFeatureDefinitions } from '@/lib/fish/features';
import { deepDigCsv } from '../export';
import { groupDeepDigFeatures } from '@/lib/customIndicatorGroups';
import type { TradeSignal } from '@/lib/signalLibrary';
import { makeQualityBuyFilter, qualityFilterChoices } from '@/lib/fish/qualityFilters';
import { qualityDefinition } from '@/lib/fish/quality';

describe('MBI integration and acceptance F', () => {
  it('every prior feature, all formula variables and averages are bit-for-bit unchanged', () => {
    const bars = mbiBars();
    for (const def of BUILTIN_FEATURES.filter(d => d.id !== 'mbi')) {
      const program = compileFeatureFormula(def.formula).program;
      const named = new Set(program.statements.flatMap(s => s.name ? [s.name] : []));
      const core = program.statements.at(-1)!.name!;
      const formula = appendResearchAverages(def.formula, named, { core, avg: `avg_${core}`, avg2: `avg_${core}_2` });
      const out = evaluateOnBars(bars, compileFeatureFormula(formula), def);
      const values = JSON.stringify([...out.vars].map(([name, value]) => [name, typeof value === 'number' ? value : Array.from(value)]));
      const expected = baseline.entries[def.id as keyof typeof baseline.entries];
      expect({ sha256: createHash('sha256').update(values).digest('hex'), definitionKey: definitionKey(def), windowMs: featureWindowMs(def) }, def.id).toEqual(expected);
    }
    console.info('MBI F baseline', JSON.stringify({ features: 13, barsEach: 900, allNamedVariablesAndAverages: true, changedNumericalFingerprints: 0 }));
  });

  it('registers after CBI2, preserves other definitions, and exposes raw and smoothed values to fishing', () => {
    const defs = mergeFeatureDefs([]), index = defs.findIndex(d => d.id === CBI2_DEF.id);
    expect(defs[index + 1]).toEqual(MBI_DEF);
    const grouped = groupDeepDigFeatures(defs).flatMap(group => group.items);
    expect(grouped[grouped.findIndex(d => d.id === 'cbi2') + 1].id).toBe('mbi');
    const names = fishStatistics(fishFeatureDefinitions(defs).find(d => d.id === 'mbi')!).map(d => d.name);
    expect(names).toEqual(expect.arrayContaining(['MBI', 'avg_MBI', 'avg_MBI_2']));
    for (const statistic of ['MBI', 'avg_MBI_2']) {
      const plan = compileFishProgram(MBI_DEF, { statistic, direction: '>', threshold: .8, constraints: [] });
      expect(plan.unavailable).toBeUndefined(); expect(plan.warm).toBeGreaterThanOrEqual(701);
    }
  });

  it('fetches 701 5m bars and leaves all 576 analysis-window bars valid; masks warmup in every average', () => {
    const bars = mbiBars(701), anchor = 701 * 300000, compiled = compileFeatureFormula(MBI_DEF.formula);
    expect(featureWindowMs(MBI_DEF)).toBe(701 * 300000);
    expect(featureWindowMs({ ...MBI_DEF, halfLifeHours: 72 })).toBe(701 * 300000); // Unused hl cannot alter MBI's seed.
    const literal = { ...MBI_DEF, formula: MBI_DEF.formula.replace('mbiz(C, MBI_N)', 'mbiz(C, 50)') };
    expect(featureWindowMs(literal)).toBe(826 * 300000); // Edited formula periods also warm the entire 48h window.
    const window = extractWindow([...bars, ...mbiBars(10).map(b => ({ ...b, openTime: anchor + b.openTime }))], anchor, featureWindowMs(MBI_DEF));
    expect(window.bars).toHaveLength(701); expect(window.coverage).toBe(1);
    const out = evaluateOnBars(window.bars, compiled, MBI_DEF);
    const values = out.vars.get('MBI') as Float64Array, avg = out.vars.get('avg_MBI') as Float64Array, weighted = out.vars.get('avg_MBI_2') as Float64Array;
    expect(values.slice(125).length).toBe(576); expect(Array.from(values.slice(125)).every(Number.isFinite)).toBe(true);
    expect(Array.from(avg.slice(0, 125)).every(Number.isNaN)).toBe(true);
    const block = rollingMean(values, 72);
    expect(weighted[700]).toBe((4 * block[700] + 3 * block[628] + 2 * block[556] + block[484]) / 10);
    expect(computeFeatureValues(window, compiled, MBI_DEF).value).toBe(values[700]);
    const priceOnly = { ...window, bars: window.bars.map(b => ({ ...b, volume: NaN, quoteVolume: null, takerBuyVolume: null, takerBuyQuoteVolume: null, refClose: null })) };
    expect(computeFeatureValues(priceOnly, compiled, MBI_DEF)).toEqual(computeFeatureValues(window, compiled, MBI_DEF));
    const short = extractWindow(bars, anchor, 300000 * 100);
    expect(computeFeatureValues(short, compiled, MBI_DEF).value).toBeNull();
    const gaps = extractWindow(bars.filter((_, i) => i % 10), anchor, featureWindowMs(MBI_DEF));
    expect(computeFeatureValues(gaps, compiled, MBI_DEF).value).toBeNull();
  });

  it('uses the identical averaging builder as CBI2, full precision storage and common export', () => {
    const item = CUSTOM_RESEARCH_INDICATORS.find(d => d.id === 'MBI')!;
    const cbi = CUSTOM_RESEARCH_INDICATORS.find(d => d.id === 'CBI2')!;
    const cbiAverages = researchChartFormula(cbi, CBI2_DEF.formula).slice(CBI2_DEF.formula.length).replace(/CBI2/g, 'MBI');
    expect(MBI_DEF.formula).toContain(cbiAverages.trim());
    const bars = mbiBars(1200), compiled = compileFeatureFormula(MBI_DEF.formula), { names } = formulaVariables(MBI_DEF.formula);
    const series = computeEventSeries(bars, 900 * 300000, compiled, MBI_DEF, names, [0])!;
    expect(series).toBeInstanceOf(Float64Array);
    expect(Array.from(structuredClone(series))).toEqual(Array.from(series));
    const window = extractWindow(bars, 900 * 300000, featureWindowMs(MBI_DEF));
    const values = computeFeatureValues(window, compiled, MBI_DEF);
    const data = makeData(); data.definition = snapshotOf(MBI_DEF); data.rows = [{ ...data.rows[0], v: values.value, vars: values.vars }];
    const csv = deepDigCsv(data);
    expect(csv).toContain('MBI,avg_MBI'); expect(csv).toContain('avg_MBI_2'); expect(csv).toContain(String(values.vars.avg_MBI_2));
    expect(JSON.parse(JSON.stringify(data)).rows[0].vars).toEqual(values.vars);
    const k = bars.map(b => ({ timestamp: b.openTime, open: b.open, high: b.high, low: b.low, close: b.close }));
    const chart = researchChartSeries(k, item, 25, { fetchReference: false });
    const expected = computeMbi(bars.map(b => b.close));
    expect(chart.core).toEqual(Array.from(expected.mbi, v => Number.isFinite(v) ? v : null));
  });

  it('parameter changes invalidate the same frozen definitions; all existing group rules stay intact', () => {
    const changed = { ...MBI_DEF, MBI_N: 10, MBI_Z0: .8 };
    expect(definitionKey(changed)).not.toBe(definitionKey(MBI_DEF)); expect(snapshotOf(changed)).toMatchObject({ MBI_N: 10, MBI_Z0: .8 });
    const out = evaluateOnBars(mbiBars(), compileFeatureFormula(changed.formula), changed);
    const direct = computeMbi(mbiBars().map(b => b.close), changed);
    expect(out.vars.get('MBI')).toEqual(direct.mbi);
    expect(checkDefinition({ ...MBI_DEF, MBI_N: 0 }).formula).toContain('MBI_N');
    expect(checkDefinition({ ...MBI_DEF, MBI_Z0: 0 }).formula).toContain('MBI_Z0');
    for (const quality of [0, 1, 2, 3, 4, 5]) {
      const sample = signalSample({ id: 's', symbol: 'ORDIUSDT', timeMs: 1, quality } as TradeSignal);
      const rules = compileGroups(DEFAULT_GROUPS.signals.positive, DEFAULT_GROUPS.signals.control, 'signals');
      expect(classifySample(sample, rules).group).toBe(quality === 0 ? 'other' : quality >= 3 ? 'positive' : 'control');
    }
    expect(MBI_DEF.positive).toBe(CBI2_DEF.positive); expect(MBI_DEF.control).toBe(CBI2_DEF.control);
    expect(qualityFilterChoices([changed]).map(c => c.metric)).toEqual(expect.arrayContaining(['MBI', 'avg_MBI_2']));
    const filter = makeQualityBuyFilter('mbi:avg_MBI_2', '>', .8, true, [changed]);
    expect(qualityDefinition(filter.snapshot)).toMatchObject({ MBI_N: 10, MBI_Z0: .8 });
  });

  it('both MBI and avg_MBI_2 enter the same inference report without changing sample labels', () => {
    const data = makeData(); data.definition = snapshotOf(MBI_DEF);
    data.rows = data.rows.map((r, i) => ({ ...r, v: Math.sin(i / 5), vars: { MBI: Math.sin(i / 5), avg_MBI_2: Math.cos(i / 7) } }));
    const originalGroups = data.rows.map(r => r.group);
    const result = runInference(data, 'ttest(MBI, 实验组, 对照组)\nttest(avg_MBI_2, 实验组, 对照组)\nmannwhitney(MBI, 实验组, 随机, perm=19)\nmannwhitney(avg_MBI_2, 实验组, 随机, perm=19)');
    expect(result.blocks.map(b => b.kind)).toEqual(['ttest', 'ttest', 'mannwhitney', 'mannwhitney']);
    expect(data.rows.map(r => r.group)).toEqual(originalGroups);
    expect(viewForVariable(data, 'avg_MBI_2').rows[0].v).toBe(1);
  });

  it('cached evaluation and closed-candle truncation have no future leakage', () => {
    const bars = mbiBars(), compiled = compileFeatureFormula(MBI_DEF.formula), cache = createFormulaEvaluationCache();
    evaluateOnBars(bars.slice(0, 300), compiled, MBI_DEF, cache);
    const updated = evaluateOnBars(bars, compiled, MBI_DEF, cache), direct = evaluateOnBars(bars, compiled, MBI_DEF);
    for (const [name, value] of updated.vars) expect(value, name).toEqual(direct.vars.get(name));
    const anchor = 700 * 300000 + 120000;
    const before = extractWindow(bars.filter(b => b.openTime < anchor), anchor, featureWindowMs(MBI_DEF));
    const full = extractWindow(bars, anchor, featureWindowMs(MBI_DEF));
    expect(before.bars).toEqual(full.bars);
    expect(full.bars.at(-1)!.openTime).toBe(699 * 300000);
    expect(computeFeatureValues(before, compiled, MBI_DEF)).toEqual(computeFeatureValues(full, compiled, MBI_DEF));
    expect(lastValue(direct.vars.get('MBI')!)).not.toBeNull();
  });

  it('15m periods use candle-based n and hour-based shared averages; forming replay candle stays empty', () => {
    const bars = mbiBars(701, 900000), item = CUSTOM_RESEARCH_INDICATORS.find(d => d.id === 'MBI')!;
    const input = bars.map(b => ({ timestamp: b.openTime, open: b.open, high: b.high, low: b.low, close: b.close, cba2Closed: true }));
    const chart = researchChartSeries(input, item, 25, { fetchReference: false });
    const direct = evaluateOnBars(bars, compileFeatureFormula(MBI_DEF.formula), { ...MBI_DEF, interval: '15m' });
    expect(chart.avg2.at(-1)).toBe(lastValue(direct.vars.get('avg_MBI_2')!));
    input.at(-1)!.cba2Closed = false;
    const forming = researchChartSeries(input, item, 25, { fetchReference: false });
    expect(forming.core.at(-1)).toBeNull(); expect(forming.avg2.at(-1)).toBeNull();
    expect(forming.core.slice(0, -1)).toEqual(chart.core.slice(0, -1));
  });
});
