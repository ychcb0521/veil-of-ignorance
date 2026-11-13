import { compileFeatureFormula, type CompiledFeature } from '@/lib/deepDig/features';
import { shortFishHash, type FishSnapshot } from './algorithm';
import { qualityDefinition, qualityMetricPlan, type QualityBuyFilter } from './quality';

export const ADDITION_INDICATOR_TIME_VERSION = 'addition-indicator-time-v1';
const TIME_FIELD = 'addition-time=';
const BASE_FIELD = 'addition-base=';
const BASE_LABEL_FIELD = 'addition-label=';
export type AdditionMetricTime = Partial<Record<'window' | 'avgh' | 'hl', string>>;
type TimeField = keyof AdditionMetricTime;
type Expression = CompiledFeature['program']['statements'][number]['expr'];

function timedDefinitionFields(snapshot: FishSnapshot): string[] {
  if (!snapshot.definitionKey?.includes(ADDITION_INDICATOR_TIME_VERSION)) return [];
  try {
    const parts: unknown = JSON.parse(snapshot.definitionKey);
    return Array.isArray(parts) ? parts.slice(4).filter((value): value is string => typeof value === 'string') : [];
  } catch { return []; }
}
export const hasAdditionMetricTime = (snapshot: FishSnapshot) => timedDefinitionFields(snapshot).includes(ADDITION_INDICATOR_TIME_VERSION);

export function additionMetricBaseDefinition(snapshot: FishSnapshot) {
  const saved = timedDefinitionFields(snapshot).find(value => value.startsWith(BASE_FIELD));
  return qualityDefinition(saved ? { ...snapshot, definitionKey: saved.slice(BASE_FIELD.length) } : snapshot);
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
  if (averageSeries(metric, new Set(statements.flatMap(s => s.name ? [s.name] : [])))) return ['window'];
  const inputs = new Set([metric]);
  for (let i = statements.length - 1; i >= 0; i--) {
    const statement = statements[i];
    if ((statement.name && inputs.delete(statement.name)) || (metric === '结果' && i === statements.length - 1)) {
      expressionInputs(statement.expr, inputs);
    }
  }
  return [
    ...(inputs.has('avgh') || inputs.has('平均时长') ? ['avgh' as const] : []),
    ...(inputs.has('hl') || inputs.has('半衰期') ? ['hl' as const] : []),
  ];
}

/** A local parameter choice freezes a new executable formula on this condition only. */
export function withAdditionMetricTime(base: QualityBuyFilter, time: AdditionMetricTime = {}): QualityBuyFilter {
  const snapshot = base.snapshot;
  const originalTime = additionMetricTime(snapshot);
  if (JSON.stringify(time) === JSON.stringify(originalTime)) return base;
  const key = JSON.parse(snapshot.definitionKey!) as unknown[];
  // The original key lets future edits start from the same frozen account formula.
  const original = key.slice(4).find((item): item is string => typeof item === 'string' && item.startsWith(BASE_FIELD));
  const baseKey = original ? original.slice(BASE_FIELD.length) : snapshot.definitionKey!;
  const savedLabel = key.slice(4).find((item): item is string => typeof item === 'string' && item.startsWith(BASE_LABEL_FIELD));
  const baseLabel = savedLabel?.slice(BASE_LABEL_FIELD.length) ?? base.label;
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
  if (selected.length) {
    const names = new Set(compileFeatureFormula(parts[0]).program.statements.flatMap(s => s.name ? [s.name] : []));
    for (const [field, hours] of selected) {
      if (field === 'window') {
        const { core, weighted } = averageSeries(base.metric, names)!;
        // Keep the selected series name for result evidence and the existing rule readers.
        if (weighted) {
          let block = '_addition_mean';
          while (names.has(block)) block += '_';
          const quarter = hours / 4;
          parts[0] += `\n${block} = avg(${core}, ${quarter})\n${base.metric} = (4 * ${block} + 3 * ago(${block}, ${quarter}) + 2 * ago(${block}, ${hours / 2}) + ago(${block}, ${hours * 0.75})) / 10`;
        } else parts[0] += `\n${base.metric} = avg(${core}, ${hours})`;
      } else {
        const parameter = field + '=';
        const i = parts.findIndex((value, index) => index >= 4 && typeof value === 'string' && value.startsWith(parameter));
        if (i >= 0) parts[i] = parameter + hours;
        else parts.push(parameter + hours);
      }
    }
    const timeRecord = Object.fromEntries(selected.map(([field,hours]) => [field, String(hours)]));
    parts.push(ADDITION_INDICATOR_TIME_VERSION, TIME_FIELD + JSON.stringify(timeRecord), BASE_FIELD + baseKey, BASE_LABEL_FIELD + baseLabel);
  }
  const definitionKey = selected.length ? JSON.stringify(parts) : baseKey;
  const label = [baseLabel, ...selected.map(([field,hours]) => `${labels[field]} ${hours} 小时`)].join(' · ');
  const next = { ...snapshot, definitionKey };
  if (selected.length) qualityMetricPlan(next, base.metric);
  const choice = snapshot.featureId + ':' + base.metric;
  const id = 'buy-' + shortFishHash(JSON.stringify([choice, base.direction, base.threshold, ...(selected.length ? [definitionKey] : [])]));
  return { ...base, id, label, snapshot: next };
}
