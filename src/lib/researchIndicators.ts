/** Five Deep dig features exposed on the chart, each with its two named averages. */
import type { KLineData } from 'klinecharts';
import { accountFeatureDef, chartFeatureSeries } from '@/lib/featureSource';
import { compileFeatureFormula, avgHoursOf, halfLifeOf } from '@/lib/deepDig/features';
import { btcClosesAt, requestBtcReference, btcReferenceVersion } from '@/lib/btcReference';
import { inferIntervalMs, DSP_BASE_INTERVAL_MS } from '@/lib/dynamicSchellingPoint';

export const RESEARCH_INDICATORS = [
  { id: 'STATE', featureId: 'state', core: 'state', short: '状态 S', name: '多空状态 S（0–1）', period: 24, parameter: '基线时长', neutral: 0.5, min: 0, max: 1, seller: false },
  { id: 'CDI2', featureId: 'cdi2', core: 'CDI2', short: 'CDI2', name: '买方失控程度 CDI2', period: 24, parameter: '基线时长', neutral: 0, min: -1, max: 1, seller: true },
  { id: 'DSP_B', featureId: 'drift-speed-down-z', core: 'b', short: 'DSP·b', name: '向下推动力量 DSP·b', period: 6, parameter: '半衰期', neutral: 0, min: 0, max: 0, seller: true },
  { id: 'DSS', featureId: 'dss', core: 'DSS', short: 'DSS', name: '买方状态恶化 DSS', period: 1, parameter: '近期窗口', neutral: 0, min: -1, max: 1, seller: true },
  { id: 'CDA', featureId: 'cda', core: 'CDA', short: 'CDA', name: '买方阻力 CDA', period: 6, parameter: '半衰期', neutral: 0, min: 0, max: 0, seller: true },
] as const;
export type ResearchIndicator = typeof RESEARCH_INDICATORS[number];
export const researchKcName = (id: string, level = 0) => `${id}${level === 1 ? '_AVG' : level === 2 ? '_AVG2' : ''}_CUSTOM`;
export function researchIndicatorForKc(name: string): ResearchIndicator | undefined {
  return RESEARCH_INDICATORS.find(item => [0, 1, 2].some(level => researchKcName(item.id, level) === name));
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
  const extra: string[] = [];
  if (!names.has(`avg_${item.core}`)) extra.push(`avg_${item.core} = avg(${item.core}, 24)`);
  if (!names.has(`avg_${item.core}_2`)) {
    let helper = '_chart_m6';
    while (names.has(helper)) helper += '_';
    extra.push(`${helper} = avg(${item.core}, 6)`, `avg_${item.core}_2 = (4 * ${helper} + 3 * ago(${helper}, 6) + 2 * ago(${helper}, 12) + ago(${helper}, 18)) / 10`);
  }
  return [formula, ...extra].join('\n');
}

export function researchDefaultPeriod(item: ResearchIndicator): number {
  const def = accountFeatureDef(item.featureId);
  if (!def) return item.period;
  if (item.id === 'STATE' || item.id === 'CDI2') return avgHoursOf(def);
  if (item.id !== 'DSS') return halfLifeOf(def);
  try {
    const st = compileFeatureFormula(def.formula).program.statements.find(s => s.name === 'n');
    if (st?.expr.k === 'num' && st.expr.v > 0) return st.expr.v;
  } catch { /* Invalid account definitions produce blank chart series. */ }
  return item.period;
}

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
  let ref: (number | null)[] | undefined;
  if (usesBtc && data.length) {
    const times = data.map(d => d.timestamp), interval = inferIntervalMs(times.map(time => ({ time }))) ?? DSP_BASE_INTERVAL_MS;
    if (options.fetchReference !== false) requestBtcReference(times[0], times[times.length - 1] + interval, interval);
    ref = btcClosesAt(times, interval);
  }
  const out = chartFeatureSeries(data, item.featureId, period, ref, { formula, revision: `${dataRevision(data)}:${usesBtc ? btcReferenceVersion() : 0}` });
  const scaled = (name: string) => (out?.vars.get(name) ?? data.map(() => null)).map(v => v == null ? null : v * def.scale);
  // Do not use out.core: the last account expression may itself be the weighted average.
  return { core: scaled(item.core), avg: scaled(`avg_${item.core}`), avg2: scaled(`avg_${item.core}_2`) };
}
