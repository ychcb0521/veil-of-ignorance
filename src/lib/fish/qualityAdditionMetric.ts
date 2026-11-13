import { compileFeatureFormula, definitionKey, intervalOf, type CompiledFeature, type DeepDigFeatureDef } from '@/lib/deepDig/features';
import { RESEARCH_INTERVALS } from '@/lib/deepRsa/marketData';
import type { ResearchInterval } from '@/lib/deepRsa/marketData';
import { shortFishHash, type FishSnapshot } from './algorithm';
import { qualityDefinition, qualityMetricPlan, type QualityBuyFilter } from './quality';

export const ADDITION_INDICATOR_TIME_VERSION = 'addition-indicator-time-v1';
export const INDICATOR_PERIOD_VERSION = 'indicator-period-v1';
export const INDICATOR_FORMULA_TIME_VERSION = 'indicator-formula-time-v1';
const TIME_FIELD = 'addition-time=';
const BASE_FIELD = 'addition-base=';
const BASE_LABEL_FIELD = 'addition-label=';
const BASE_INTERVAL_FIELD = 'base-interval=';
type TimeField = 'window' | 'avgh' | 'hl';
export type AdditionMetricTime = Partial<Record<TimeField, string>> & { interval?: ResearchInterval };
type Expression = CompiledFeature['program']['statements'][number]['expr'];

function timedDefinitionFields(snapshot: FishSnapshot): string[] {
  if (!snapshot.definitionKey?.includes(ADDITION_INDICATOR_TIME_VERSION)) return [];
  try {
    const parts: unknown = JSON.parse(snapshot.definitionKey);
    return Array.isArray(parts) ? parts.slice(4).filter((value): value is string => typeof value === 'string') : [];
  } catch { return []; }
}
export const hasAdditionMetricTime = (snapshot: FishSnapshot) => timedDefinitionFields(snapshot).includes(ADDITION_INDICATOR_TIME_VERSION);
export const hasMetricPeriodOverride = (snapshot: FishSnapshot) => timedDefinitionFields(snapshot).includes(INDICATOR_PERIOD_VERSION);
export const hasMetricFormulaTimeOverride = (snapshot: FishSnapshot) => timedDefinitionFields(snapshot).includes(INDICATOR_FORMULA_TIME_VERSION);

export function additionMetricBaseDefinition(snapshot: FishSnapshot) {
  const fields = timedDefinitionFields(snapshot);
  const saved = fields.find(value => value.startsWith(BASE_FIELD));
  const interval = fields.find(value => value.startsWith(BASE_INTERVAL_FIELD))?.slice(BASE_INTERVAL_FIELD.length) as ResearchInterval | undefined;
  return qualityDefinition(saved ? { ...snapshot, definitionKey: saved.slice(BASE_FIELD.length), interval: interval ?? snapshot.interval } : snapshot);
}

export function additionMetricTime(snapshot: FishSnapshot): AdditionMetricTime {
  const encoded = timedDefinitionFields(snapshot).find(value => value.startsWith(TIME_FIELD));
  try { return encoded ? JSON.parse(encoded.slice(TIME_FIELD.length)) : {}; }
  catch { return {}; }
}

function averageSeries(metric: string, names: ReadonlySet<string>) {
  const weighted = metric.endsWith('_2');
  const core = metric.startsWith('avg_') ? metric.slice(4, weighted ? -2 : undefined) : '';
  return core && names.has(core) ? { core, weighted } : undefined;
}

function expressionInputs(expr: Expression, inputs: Set<string>): void {
  if (expr.k === 'var') inputs.add(expr.name);
  if (expr.k === 'un' || expr.k === 'bin') expressionInputs(expr.a, inputs);
  if (expr.k === 'bin') expressionInputs(expr.b, inputs);
  if (expr.k === 'call') for (const arg of expr.args) expressionInputs(arg, inputs);
}

export function additionMetricTimeFields(formula: string, metric: string): TimeField[] {
  const { statements } = compileFeatureFormula(formula).program;
  const selected = metric === '结果' ? statements.at(-1)?.name ?? metric : metric;
  const average = averageSeries(selected, new Set(statements.flatMap(s => s.name ? [s.name] : [])));
  const inputs = new Set([average?.core ?? selected]);
  for (let i = statements.length - 1; i >= 0; i--) {
    const statement = statements[i];
    if ((statement.name && inputs.delete(statement.name)) || (selected === '结果' && i === statements.length - 1)) {
      expressionInputs(statement.expr, inputs);
    }
  }
  return [
    ...(average ? ['window' as const] : []),
    ...(inputs.has('avgh') || inputs.has('平均时长') ? ['avgh' as const] : []),
    ...(inputs.has('hl') || inputs.has('半衰期') ? ['hl' as const] : []),
  ];
}

export function metricIntervalOptions(definition: DeepDigFeatureDef) {
  const compiled = compileFeatureFormula(definition.formula);
  if (compiled.usesDbl5 || compiled.usesSbs5m) return ['5m' as const];
  const intervals = RESEARCH_INTERVALS.filter(interval => intervalOf({ ...definition, interval }) === interval);
  return intervals.length ? intervals : [intervalOf(definition)];
}

export function withFishDefinitionTime(definition: DeepDigFeatureDef, metric: string, time?: AdditionMetricTime): DeepDigFeatureDef {
  if (!time || !Object.keys(time).length) return definition;
  const { snapshot } = withMetricSnapshotTime({ label:definition.short, metric,
    snapshot:{ featureId:definition.id, definitionKey:definitionKey(definition), interval:intervalOf(definition),
      statistic:metric, threshold:0, cutoffMs:0, average:0, cbi2:0, startAverage:0, previousAverage:0 },
  },time);
  const { formula, interval, avgHours, halfLifeHours } = qualityDefinition(snapshot);
  return { ...definition, formula, interval, avgHours, halfLifeHours };
}

export function withMetricSnapshotTime<T extends Pick<QualityBuyFilter, 'label' | 'metric' | 'snapshot'>>(
  metric: T, time: AdditionMetricTime | undefined,
): T {
  if (time === undefined) return metric;
  const { label, snapshot } = withAdditionMetricTime({
    ...metric, id: '', enabled: true, direction: metric.snapshot.direction ?? '>', threshold: metric.snapshot.threshold,
  }, time);
  return snapshot === metric.snapshot ? metric : { ...metric, label, snapshot };
}

/** A local parameter choice freezes a new executable formula on this condition only. */
export function withAdditionMetricTime(base: QualityBuyFilter, time: AdditionMetricTime = {}): QualityBuyFilter {
  const snapshot = base.snapshot;
  const originalTime = additionMetricTime(snapshot);
  if ((['interval','window','avgh','hl'] as const).every(field => time[field] === originalTime[field])) return base;
  const key = JSON.parse(snapshot.definitionKey!) as unknown[];
  // The original key lets future edits start from the same frozen account formula.
  const original = key.slice(4).find((item): item is string => typeof item === 'string' && item.startsWith(BASE_FIELD));
  const baseKey = original ? original.slice(BASE_FIELD.length) : snapshot.definitionKey!;
  const savedLabel = key.slice(4).find((item): item is string => typeof item === 'string' && item.startsWith(BASE_LABEL_FIELD));
  const baseLabel = savedLabel?.slice(BASE_LABEL_FIELD.length) ?? base.label;
  const definition = additionMetricBaseDefinition(snapshot);
  const baseInterval = definition.interval!;
  const interval = time.interval ?? baseInterval;
  if (time.interval && !metricIntervalOptions(definition).includes(time.interval)) throw Error('所选 K 线周期不适用于此指标');
  const periodChanged = interval !== baseInterval;
  const parts = JSON.parse(baseKey) as [string, ...unknown[]];
  const fields = additionMetricTimeFields(parts[0], base.metric);
  const labels: Record<TimeField, string> = {window:'均值窗口', avgh:'公式回看', hl:'半衰期'};
  const selected = fields.flatMap(field => {
    const raw = time[field]?.trim();
    if (!raw) return [];
    const hours = Number(raw);
    if (!Number.isFinite(hours) || hours <= 0) throw Error(`${labels[field]}须为大于 0 的有限小时数`);
    return [[field, hours] as const];
  });
  const configured = periodChanged || selected.length > 0;
  if (configured) {
    const statements = compileFeatureFormula(parts[0]).program.statements;
    const names = new Set(statements.flatMap(s => s.name ? [s.name] : []));
    const metric = base.metric === '结果' ? statements.at(-1)?.name ?? base.metric : base.metric;
    if (selected.length && (base.metric === '结果' || averageSeries(metric,names) && selected.some(([field])=>field!=='window'))) {
      parts.push(INDICATOR_FORMULA_TIME_VERSION);
    }
    for (const [field, hours] of selected) {
      if (field === 'window') {
        const { core, weighted } = averageSeries(metric, names)!;
        // Keep the selected series name for result evidence and the existing rule readers.
        if (weighted) {
          let block = '_addition_mean';
          while (names.has(block)) block += '_';
          const quarter = hours / 4;
          parts[0] += `\n${block} = avg(${core}, ${quarter})\n${metric} = (4 * ${block} + 3 * ago(${block}, ${quarter}) + 2 * ago(${block}, ${hours / 2}) + ago(${block}, ${hours * 0.75})) / 10`;
        } else parts[0] += `\n${metric} = avg(${core}, ${hours})`;
      } else {
        const parameter = field + '=';
        const i = parts.findIndex((value, index) => index >= 4 && typeof value === 'string' && value.startsWith(parameter));
        if (i >= 0) parts[i] = parameter + hours;
        else parts.push(parameter + hours);
      }
    }
    const timeRecord: AdditionMetricTime = Object.fromEntries(selected.map(([field,hours]) => [field, String(hours)]));
    if (periodChanged) {
      const index = parts.findIndex((value, i) => i >= 4 && typeof value === 'string' && /^\d+[mhdwM]$/.test(value));
      if (index !== -1) parts.splice(index, 1);
      if (interval !== '5m') parts.splice(4, 0, interval);
      timeRecord.interval = interval;
      parts.push(INDICATOR_PERIOD_VERSION, BASE_INTERVAL_FIELD + baseInterval);
    }
    parts.push(ADDITION_INDICATOR_TIME_VERSION, TIME_FIELD + JSON.stringify(timeRecord), BASE_FIELD + baseKey, BASE_LABEL_FIELD + baseLabel);
  }
  const definitionKey = configured ? JSON.stringify(parts) : baseKey;
  const label = [baseLabel, ...(periodChanged ? [interval] : []), ...selected.map(([field,hours]) => `${labels[field]} ${hours} 小时`)].join(' · ');
  const next = { ...snapshot, definitionKey, ...(periodChanged || originalTime.interval ? { interval } : {}) };
  if (configured) qualityMetricPlan(next, base.metric);
  const choice = snapshot.featureId + ':' + base.metric;
  const id = 'buy-' + shortFishHash(JSON.stringify([choice, base.direction, base.threshold, ...(configured ? [definitionKey] : [])]));
  return { ...base, id, label, snapshot: next };
}
