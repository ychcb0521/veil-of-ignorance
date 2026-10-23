/** Deep dig chart features: raw value and the two named averages share one formula. */
import type { KLineData } from 'klinecharts';
import { chartFeatureDef as accountFeatureDef, chartFeatureSeries, chartFeatureHistoryBars } from '@/lib/featureSource';
import { compileFeatureFormula, avgHoursOf, halfLifeOf } from '@/lib/deepDig/features';
import { chartPrehistory, researchHistoryVersion } from '@/lib/researchChartHistory';
import { btcClosesAt, requestBtcReference, btcReferenceVersion } from '@/lib/btcReference';
import { inferIntervalMs, DSP_BASE_INTERVAL_MS } from '@/lib/dynamicSchellingPoint';
import { enableChartComputation, isChartComputationEnabled, chartComputationVersion, resetChartComputationAlignment } from './chartComputeClient';
import { displayAverage } from '@/lib/avgHighlight';

// avgRange：均值副图固定纵轴（有固定范围的指标）。【用户要求】2026-10-22「把有固定范围的指标的均值副图纵轴也固定住：状态 S 0–1，CDI2 和 DSS ±1，CDA ±100」
export const RESEARCH_INDICATORS = [
  { id: 'STATE', featureId: 'state', core: 'state', short: '状态 S', name: '多空状态 S（0–1）', period: 24, parameter: '基线时长', neutral: 0.6, avgNeutral: 0.6, min: 0, max: 1, avgRange: [0, 1], seller: false }, // 【用户要求】2026-10-22 橘色线（线上绿、线下红）：原始值与两条均值线都在 0.6
  { id: 'STATE2', featureId: 'state2', core: 'state2', short: '状态 S2', name: '多空状态 S2（0–1）', period: 24, parameter: '基线时长', neutral: 0.6, avgNeutral: 0.6, min: 0, max: 1, avgRange: [0, 1], seller: false },
  { id: 'CDI2', featureId: 'cdi2', core: 'CDI2', short: 'CDI2', name: '买方失控程度 CDI2', period: 24, parameter: '基线时长', neutral: 0, min: -1, max: 1, avgRange: [-1, 1], seller: true },
  { id: 'SELLER_CONTROL', featureId: 'seller-control', core: 'bc', short: 'DSP·bc', name: '卖方控制力 DSP·bc', period: 6, parameter: '半衰期', neutral: 0, min: 0, max: 0, seller: true },
  { id: 'DSS', featureId: 'dss', core: 'DSS', short: 'DSS', name: '买方状态恶化 DSS', period: 1, parameter: '近期窗口', neutral: 0, avgNeutral: 0, min: -1, max: 1, avgRange: [-1, 1], seller: true },
  { id: 'CDA', featureId: 'cda', core: 'CDA', short: 'CDA', name: '买方阻力 CDA', period: 6, parameter: '半衰期', neutral: 0, min: 0, max: 0, avgRange: [-100, 100], seller: true },
] as const;
export const BUYER_RESEARCH_INDICATORS = [
  { id: 'DSP_VA', featureId: 'drift-speed', core: 'a', short: 'DSP·a', name: '买方推力漂移速度 DSP·a', period: 6, parameter: '半衰期', neutral: 0, min: 0, max: 0, seller: false },
  { id: 'BSS', featureId: 'bss', core: 'BSS', short: 'BSS', name: '买卖强度综合分 BSS', period: 1, parameter: '近期窗口', neutral: 0, min: -1, max: 1, seller: false },
  { id: 'CBA', featureId: 'cba', core: 'CBA', short: 'CBA', name: '买方定价优势指数 CBA', period: 6, parameter: '半衰期', neutral: 0, min: 0, max: 0, seller: false },
  { id: 'DSP_Z', featureId: 'drift-speed-z', core: 'az', short: 'DSP·az', name: '买方推力漂移速度 DSP·az（波动率归一化）', period: 6, parameter: '半衰期', neutral: 0, min: 0, max: 0, seller: false },
  { id: 'CBI2', featureId: 'cbi2', core: 'CBI2', short: 'CBI-2', name: '买方优势指数 CBI-2', period: 24, parameter: '基线时长', neutral: 0, min: -1, max: 1, seller: false },
] as const;
export const CUSTOM_RESEARCH_INDICATORS = [...BUYER_RESEARCH_INDICATORS, ...RESEARCH_INDICATORS];
export type ResearchIndicator = typeof CUSTOM_RESEARCH_INDICATORS[number];

/** Replace saved DSP·b chart selections; a separately configured seller-control selection wins. */
export function migrateResearchIndicators<T extends { type: string }>(saved: readonly T[]): T[] {
  const hasControl = saved.some(item => item.type === 'SELLER_CONTROL');
  let replaced = hasControl;
  return saved.flatMap(item => {
    if (item.type !== 'DSP_B') return [item];
    if (replaced) return [];
    replaced = true;
    return [{ ...item, type: 'SELLER_CONTROL' }];
  });
}

export const researchKcName = (id: string, level = 0) => {
  const stem = id === 'DSP_VA' ? 'DSP_V' : id === 'DSP_Z' ? 'DSP_Z_V' : id;
  return `${stem}${level === 1 ? '_AVG' : level === 2 ? '_AVG2' : ''}_CUSTOM`;
};
export function researchIndicatorForKc(name: string): ResearchIndicator | undefined {
  return CUSTOM_RESEARCH_INDICATORS.find(item => [0, 1, 2].some(level => researchKcName(item.id, level) === name));
}

/** Some saved Z definitions call their output a, rather than the built-in az. */
export function researchSeriesNames(item: ResearchIndicator, formula: string) {
  let core: string = item.core;
  if (item.id === 'DSP_Z') {
    try {
      const names = new Set(compileFeatureFormula(formula).program.statements.map(s => s.name));
      if (!names.has('az') && names.has('a')) core = 'a';
    } catch { /* Invalid definitions leave chart series blank, including tooltips. */ }
  }
  return { core, avg: `avg_${core}`, avg2: `avg_${core}_2` };
}

const chartDataGenerations = new WeakMap<KLineData[], number>();
const chartDataChanges = new WeakMap<KLineData[], [number, number][]>();
/** The native chart calls this before every data mutation, so companion panes share one scan. */
export function invalidateResearchChartData(data: KLineData[], from = 0) {
  const revision = (chartDataGenerations.get(data) ?? 0) + 1;
  chartDataGenerations.set(data, revision);
  const changes = chartDataChanges.get(data) ?? [];
  changes.push([revision, Math.max(0, from)]);
  if (changes.length > 128) changes.shift();
  chartDataChanges.set(data, changes);
}
const chartDataCache = new WeakMap<KLineData[], { values: Float64Array; revision: number; generation?: number }>();
const DATA_FIELDS = ['timestamp', 'open', 'high', 'low', 'close', 'volume', 'turnover', 'takerBuyTurnover'] as const;
/** Compare mutable candles without allocating thousands of row arrays each frame. */
function dataRevision(data: KLineData[]): number {
  const generation = chartDataGenerations.get(data), cached = chartDataCache.get(data);
  if (generation != null && cached?.generation === generation) return cached.revision;
  // Interactive charts explicitly invalidate every mutation. Their generation
  // is sufficient; rescanning the entire history here blocks every replay tick.
  if (generation != null) {
    const revision = (cached?.revision ?? 0) + 1;
    chartDataCache.set(data, { values: cached?.values ?? new Float64Array(0), revision, generation });
    return revision;
  }
  const size = data.length * DATA_FIELDS.length;
  const values = cached?.values.length === size ? cached.values : new Float64Array(size);
  let changed = !cached || values !== cached.values;
  for (let i = 0; i < data.length; i++) for (let j = 0; j < DATA_FIELDS.length; j++) {
    const v = data[i][DATA_FIELDS[j]] ?? NaN, at = i * DATA_FIELDS.length + j;
    if (!Object.is(values[at], v)) changed = true;
    values[at] = v;
  }
  const revision = (cached?.revision ?? 0) + (changed ? 1 : 0);
  chartDataCache.set(data, { values, revision, generation });
  return revision;
}

/** Supply defaults only for missing series. Existing account expressions always win. */
export function researchChartFormula(item: ResearchIndicator, formula: string): string {
  const names = new Set(compileFeatureFormula(formula).program.statements.map(s => s.name));
  const series = researchSeriesNames(item, formula);
  const extra: string[] = [];
  if (!names.has(series.avg)) extra.push(`${series.avg} = avg(${series.core}, 24)`);
  if (!names.has(series.avg2)) {
    let helper = '_chart_m6';
    while (names.has(helper)) helper += '_';
    extra.push(`${helper} = avg(${series.core}, 6)`, `${series.avg2} = (4 * ${helper} + 3 * ago(${helper}, 6) + 2 * ago(${helper}, 12) + ago(${helper}, 18)) / 10`);
  }
  return [formula, ...extra].join('\n');
}

export function researchDefaultPeriod(item: ResearchIndicator): number {
  // 指标表的 BSS / DSS 默认近期窗口为 12 小时，图表计算仍允许手动覆盖。
  if (item.id === 'BSS' || item.id === 'DSS') return 12;
  const def = accountFeatureDef(item.featureId);
  if (!def) return item.period;
  if (item.id === 'STATE' || item.id === 'STATE2' || item.id === 'CDI2' || item.id === 'CBI2') return avgHoursOf(def);
  return halfLifeOf(def);
}

function chartInterval(data: KLineData[]) {
  const gaps: number[] = [];
  for (let i = 1; i < data.length && gaps.length < 64; i++) {
    const gap = data[i].timestamp - data[i-1].timestamp;
    if (gap > 0) gaps.push(gap);
  }
  gaps.sort((a,b)=>a-b);
  return gaps[Math.floor(gaps.length/2)] ?? DSP_BASE_INTERVAL_MS;
}
const displaySeriesCache = new WeakMap<object, Map<string, { core: (number | null)[]; avg: (number | null)[]; avg2: (number | null)[] }>>();
const extendedData = new WeakMap<KLineData[], { history: KLineData[]; revision: number; generation?: number; data: KLineData[] }>();
const EMPTY_HISTORY: KLineData[] = [];
const formulaPlans = new Map<string, { formula: string; usesBtc: boolean }>();
function formulaPlan(item: ResearchIndicator, source: string) {
  const key = `${item.core}\n${source}`;
  let plan = formulaPlans.get(key);
  if (!plan) {
    const formula = researchChartFormula(item, source);
    plan = { formula, usesBtc: compileFeatureFormula(formula).program.inputs.has('CB') };
    if (formulaPlans.size > 64) formulaPlans.clear();
    formulaPlans.set(key, plan);
  }
  return plan;
}

/** Hidden calc parameter: account formula / scale changes must invalidate chart calculations. */
export function researchDefinitionVersion(item: ResearchIndicator): number {
  const def = accountFeatureDef(item.featureId);
  let hash = 2166136261;
  for (const c of JSON.stringify([def?.formula, def?.scale, def?.unit, def?.halfLifeHours, def?.avgHours])) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  return hash >>> 0;
}

type DisplaySeries = { core: (number | null)[]; avg: (number | null)[]; avg2: (number | null)[]; pending?: boolean };
interface DisplaySnapshot { times: Map<number, number>; result: DisplaySeries }
interface DisplayHistory { snapshots: Map<string, DisplaySnapshot> }
const displayHistories = new WeakMap<KLineData[], DisplayHistory>();
const historyAnchors = new WeakMap<KLineData, DisplayHistory>();
/** Native prepend uses concat: share continuity only through actual candle objects,
 * never through a symbol/time guess that could mix charts or replay timelines. */
function displayHistory(data: KLineData[]): DisplayHistory {
  let history = displayHistories.get(data);
  if (!history) {
    for (const bar of data) { history = historyAnchors.get(bar); if (history) break; }
    history ??= { snapshots: new Map() };
    displayHistories.set(data, history);
    if (data[0]) historyAnchors.set(data[0], history);
  }
  return history;
}
/** Only the chart's verified forward-snapshot path calls this. Known values
 * remain timestamp-aligned while missing candles are repaired; a new symbol,
 * interval or rewind deliberately starts with its own history. */
export function inheritForwardResearchChartData(previous: KLineData[], next: KLineData[]) {
  const history = displayHistories.get(previous);
  if (history) displayHistories.set(next, history);
  const cached = extendedData.get(previous);
  if (cached) {
    resetChartComputationAlignment(cached.data);
    extendedData.set(next, { ...cached, revision: -1, generation: undefined });
  }
}
function continueDisplay(data: KLineData[], key: string, result: DisplaySeries): DisplaySeries {
  const history = displayHistory(data), previous = history.snapshots.get(key);
  if (result.pending && previous) {
    const indices = data.map(bar => previous.times.get(bar.timestamp));
    const aligned = (name: 'core' | 'avg' | 'avg2') => indices.map(i => i == null ? null : previous.result[name][i] ?? null);
    return { core: aligned('core'), avg: aligned('avg'), avg2: aligned('avg2'), pending: true };
  }
  if (!result.pending) {
    if (history.snapshots.size >= 32 && !history.snapshots.has(key)) history.snapshots.delete(history.snapshots.keys().next().value!);
    history.snapshots.set(key, { times: new Map(data.map((bar, i) => [bar.timestamp, i])), result });
  }
  return result;
}
type ChartSeriesOptions = { fetchReference?: boolean; averageHours?: number };
const liveSeriesCache = new WeakMap<KLineData[], Map<string, { generation: number; result: ReturnType<typeof calculateChartSeries> }>>();
export function researchChartSeries(data: KLineData[], item: ResearchIndicator, period: number, options: ChartSeriesOptions = {}) {
  const generation = chartDataGenerations.get(data);
  const def = accountFeatureDef(item.featureId);
  const continuityKey = `${item.id}|${period}|${options.averageHours ?? 24}|${researchDefinitionVersion(item)}`;
  const continuous = isChartComputationEnabled(data);
  const finish = (result: DisplaySeries) => continuous ? continueDisplay(data, continuityKey, result) : result;
  // Establish lineage even while the first worker request is still pending.
  if (continuous) displayHistory(data);
  if (generation == null) return finish(calculateChartSeries(data, item, period, options));
  const key = `${item.id}|${period}|${options.averageHours ?? 24}|${options.fetchReference !== false}|${def?.formula}|${def?.scale}|${def?.halfLifeHours}|${def?.avgHours}|${researchHistoryVersion()}|${btcReferenceVersion()}`;
  let cache = liveSeriesCache.get(data);
  // Raw and 24h companion panes read the same immutable display result during
  // one native update. Background completion must also invalidate this result.
  const computeVersion = chartComputationVersion();
  const versionKey = `${key}|${computeVersion}`;
  const current = cache?.get(versionKey);
  if (current?.generation === generation) return current.result;
  const result = finish(calculateChartSeries(data, item, period, options));
  if (!cache) { cache = new Map(); liveSeriesCache.set(data, cache); }
  if (cache.size >= 32) cache.clear();
  cache.set(versionKey, { generation, result });
  return result;
}
function calculateChartSeries(data: KLineData[], item: ResearchIndicator, period: number, options: ChartSeriesOptions = {}): DisplaySeries {
  const empty = () => ({ core: data.map(() => null as number | null), avg: data.map(() => null as number | null), avg2: data.map(() => null as number | null) });
  const def = accountFeatureDef(item.featureId);
  if (!def) return empty();
  let formula: string, usesBtc: boolean;
  try {
    ({ formula, usesBtc } = formulaPlan(item, def.formula));
    if (options.averageHours != null && options.averageHours > 24) {
      const core = researchSeriesNames(item, formula).core;
      let helper = '_display_average_history';
      while (formula.includes(helper)) helper += '_';
      // Only requests sufficient hidden history; no account expression is replaced.
      formula += `\n${helper} = avg(${core}, ${options.averageHours})`;
    }
  } catch { return empty(); }
  const visibleLength = data.length, background = isChartComputationEnabled(data);
  if (data.length) {
    const step = chartInterval(data);
    const fetched = options.fetchReference !== false ? chartPrehistory(data, chartFeatureHistoryBars(item.featureId, period, formula), step) : EMPTY_HISTORY;
    const history = fetched.length ? fetched : EMPTY_HISTORY;
    if (history.length || background) {
      const revision = dataRevision(data), cached = extendedData.get(data);
      if (cached?.history === history && cached.revision === revision) data = cached.data;
      else {
        const sameHistory = cached?.history === history;
        const combined = sameHistory ? cached.data : [...history];
        let changedFrom = 0;
        const changes = chartDataChanges.get(data), generation = chartDataGenerations.get(data);
        if (sameHistory && cached.generation != null && changes?.length && changes[0][0] <= cached.generation + 1) {
          changedFrom = Math.min(combined.length - 1, ...changes.filter(([v]) => v > cached.generation!).map(([, from]) => history.length + from));
        }
        combined.length = history.length + data.length;
        for (let i = 0; i < data.length; i++) combined[history.length + i] = data[i];
        invalidateResearchChartData(combined, changedFrom);
        extendedData.set(data, { history, revision, generation, data: combined });
        data = combined;
      }
    }
  }
  if (background) enableChartComputation(data, false);
  const visibleOffset = data.length - visibleLength;
  let ref: (number | null)[] | undefined;
  if (usesBtc && data.length) {
    const times = data.map(d => d.timestamp), interval = chartInterval(data);
    if (options.fetchReference !== false) requestBtcReference(times[0], times[times.length - 1] + interval, interval);
    ref = btcClosesAt(times, interval);
  }
  const names = researchSeriesNames(item, formula);
  const generation = chartDataGenerations.get(data);
  const out = chartFeatureSeries(data, item.featureId, period, ref, { formula, variables: [names.core, names.avg, names.avg2], revision: `${dataRevision(data)}:${researchHistoryVersion()}:${usesBtc ? btcReferenceVersion() : 0}`,
    delta: generation == null ? undefined : { revision:generation, changes:chartDataChanges.get(data) ?? [], referenceVersion:usesBtc ? btcReferenceVersion() : 0 } });
  const displayKey = `${visibleLength}|${options.averageHours ?? 24}|${def.scale}|${names.core}`;
  let displays = out ? displaySeriesCache.get(out) : undefined;
  const existing = displays?.get(displayKey);
  if (existing) return existing;
  if (!out && background) {
    const blank = () => Array<number | null>(visibleLength).fill(null);
    return { core: blank(), avg: blank(), avg2: blank(), pending: true };
  }
  const save = (result: DisplaySeries) => {
    if (out) { if (!displays) { displays = new Map(); displaySeriesCache.set(out, displays); } displays.set(displayKey, result); }
    return result;
  };
  const scaled = (name: string) => Array.from({ length: visibleLength }, (_, i) => { const v = out?.vars.get(name)?.[visibleOffset + i]; return v == null ? null : v * def.scale; });
  // Do not use out.core: the last account expression may itself be the weighted average.
  if (options.averageHours != null) {
    if (options.averageHours === 24) return save({ core: scaled(names.core), avg: scaled(names.avg), avg2: scaled(names.avg2) });
    const core = out?.vars.get(names.core) ?? data.map(() => null);
    const average = (kind: 'avg' | 'avg2') => { const values = displayAverage(core, options.averageHours!, kind); return Array.from({ length: visibleLength }, (_, i) => { const v = values[visibleOffset + i]; return Number.isFinite(v) ? v * def.scale : null; }); };
    return save({ core: scaled(names.core), avg: average('avg'), avg2: average('avg2') });
  }
  return save({ core: scaled(names.core), avg: scaled(names.avg), avg2: scaled(names.avg2) });
}
