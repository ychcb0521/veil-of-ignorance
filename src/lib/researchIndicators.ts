/** Deep dig chart features: raw value and the two named averages share one formula. */
import type { KLineData } from 'klinecharts';
import { chartFeatureDef as accountFeatureDef, chartFeatureSeries, chartFeatureHistoryBars } from '@/lib/featureSource';
import { compileFeatureFormula, avgHoursOf, halfLifeOf } from '@/lib/deepDig/features';
import { chartPrehistory, researchHistoryVersion } from '@/lib/researchChartHistory';
import { btcClosesAt, requestBtcReference, btcReferenceVersion } from '@/lib/btcReference';
import { inferIntervalMs, DSP_BASE_INTERVAL_MS } from '@/lib/dynamicSchellingPoint';

// avgRange：均值副图固定纵轴（有固定范围的指标）。【用户要求】2026-10-22「把有固定范围的指标的均值副图纵轴也固定住：状态 S 0–1，CDI2 和 DSS ±1，CDA ±100」
export const RESEARCH_INDICATORS = [
  { id: 'STATE', featureId: 'state', core: 'state', short: '状态 S', name: '多空状态 S（0–1）', period: 24, parameter: '基线时长', neutral: 0.6, avgNeutral: 0.6, min: 0, max: 1, avgRange: [0, 1], seller: false }, // 【用户要求】2026-10-22 橘色线（线上绿、线下红）：原始值与两条均值线都在 0.6
  { id: 'CDI2', featureId: 'cdi2', core: 'CDI2', short: 'CDI2', name: '买方失控程度 CDI2', period: 24, parameter: '基线时长', neutral: 0, min: -1, max: 1, avgRange: [-1, 1], seller: true },
  { id: 'SELLER_CONTROL', featureId: 'seller-control', core: 'bc', short: '卖控', name: '卖方控制力 卖控', period: 6, parameter: '半衰期', neutral: 0, min: 0, max: 0, seller: true },
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

const chartDataCache = new WeakMap<KLineData[], { rows: unknown[][]; revision: number }>();
const DATA_FIELDS = ['timestamp', 'open', 'high', 'low', 'close', 'volume', 'turnover', 'takerBuyTurnover'] as const;
/** klinecharts updates the live candle in place; array identity alone is not a cache key. */
function dataRevision(data: KLineData[]): number {
  const cached = chartDataCache.get(data);
  if (cached && cached.rows.length === data.length && data.every((bar, i) => DATA_FIELDS.every((field, j) => Object.is(bar[field], cached.rows[i][j])))) return cached.revision;
  const revision = (cached?.revision ?? 0) + 1;
  chartDataCache.set(data, { rows: data.map(bar => DATA_FIELDS.map(field => bar[field])), revision });
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
  if (item.id === 'STATE' || item.id === 'CDI2' || item.id === 'CBI2') return avgHoursOf(def);
  return halfLifeOf(def);
}

const extendedData = new WeakMap<KLineData[], { history: KLineData[]; revision: number; data: KLineData[] }>();
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

export function researchChartSeries(data: KLineData[], item: ResearchIndicator, period: number, options: { fetchReference?: boolean } = {}) {
  const empty = () => ({ core: data.map(() => null as number | null), avg: data.map(() => null as number | null), avg2: data.map(() => null as number | null) });
  const def = accountFeatureDef(item.featureId);
  if (!def) return empty();
  let formula: string, usesBtc: boolean;
  try {
    ({ formula, usesBtc } = formulaPlan(item, def.formula));
  } catch { return empty(); }
  const visibleLength = data.length;
  if (data.length && options.fetchReference !== false) {
    const step = inferIntervalMs(data.map(d => ({ time: d.timestamp }))) ?? DSP_BASE_INTERVAL_MS;
    const history = chartPrehistory(data, chartFeatureHistoryBars(item.featureId, period, formula), step);
    if (history.length) {
      const revision = dataRevision(data), cached = extendedData.get(data);
      if (cached?.history === history && cached.revision === revision) data = cached.data;
      else {
        const combined = [...history, ...data];
        extendedData.set(data, { history, revision, data: combined });
        data = combined;
      }
    }
  }
  let ref: (number | null)[] | undefined;
  if (usesBtc && data.length) {
    const times = data.map(d => d.timestamp), interval = inferIntervalMs(times.map(time => ({ time }))) ?? DSP_BASE_INTERVAL_MS;
    if (options.fetchReference !== false) requestBtcReference(times[0], times[times.length - 1] + interval, interval);
    ref = btcClosesAt(times, interval);
  }
  const out = chartFeatureSeries(data, item.featureId, period, ref, { formula, revision: `${dataRevision(data)}:${researchHistoryVersion()}:${usesBtc ? btcReferenceVersion() : 0}` });
  const scaled = (name: string) => (out?.vars.get(name) ?? data.map(() => null)).map(v => v == null ? null : v * def.scale).slice(-visibleLength);
  // Do not use out.core: the last account expression may itself be the weighted average.
  const names = researchSeriesNames(item, formula);
  return { core: scaled(names.core), avg: scaled(names.avg), avg2: scaled(names.avg2) };
}
