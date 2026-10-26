import { formatUTC8 } from '@/lib/timeFormat';
import { activeBuyFilters, qualityFilterReadingKey, type FishQualityStudy, type QualityBuyFilter, type QualityFilterReading, type QualitySample } from './quality';
import { qualityTableMembers, qualityTableRange, type QualityTableRow } from './qualityTableRows';

export interface QualityFilterColumn { id: string; filter: QualityBuyFilter; plans: string[] }
/** Equal conditions share a column, while different thresholds/formulas remain distinguishable. */
export function qualityFilterColumns(study: FishQualityStudy): QualityFilterColumn[] {
  const columns = new Map<string, QualityFilterColumn>();
  for (const plan of study.sellPlans ?? []) for (const filter of activeBuyFilters(study, plan)) {
    const id = JSON.stringify([filter.snapshot.definitionKey, filter.metric, filter.snapshot.interval, filter.direction, filter.threshold]);
    const previous = columns.get(id);
    if (previous) { if (!previous.plans.includes(plan.label)) previous.plans.push(plan.label); }
    else columns.set(id, { id, filter, plans: [plan.label] });
  }
  return [...columns.values()];
}
export const qualityFilterValueText = (value: number) => String(+value.toPrecision(8));
export function qualityFilterValue(row: QualitySample, filter: QualityBuyFilter, readings: ReadonlyMap<string, QualityFilterReading>): number | null {
  const reading = readings.get(qualityFilterReadingKey(row, filter));
  return reading && !reading.error && Number.isFinite(reading.value) ? reading.value! : null;
}
/** Render all original entries in a merged row; never make missing readings look like zero. */
export function qualityFilterCell(row: QualityTableRow, filter: QualityBuyFilter, readings: ReadonlyMap<string, QualityFilterReading>) {
  const entries = [...new Map(qualityTableMembers(row).map(member => [qualityFilterReadingKey(member, filter), member])).values()];
  let passed = 0, failed = 0, pending = 0, errors = 0;
  const details: string[] = [];
  const values = entries.map(entry => {
    const reading = readings.get(qualityFilterReadingKey(entry, filter)), value = qualityFilterValue(entry, filter, readings);
    const prefix = `买入 ${entry.enteredAt ? formatUTC8(entry.enteredAt) : '时间缺失'}`;
    if (!reading) { pending++; details.push(`${prefix}：待计算`); }
    else if (value == null) { errors++; details.push(`${prefix}：${reading.error ?? '读数无效'}`); }
    else {
      const ok = filter.direction === '>' ? value > filter.threshold : value < filter.threshold;
      if (ok) passed++; else failed++;
      details.push(`${prefix}：${value} ${ok ? '满足' : '不满足'} ${filter.direction} ${filter.threshold}${reading.at ? `；读数截止 ${formatUTC8(reading.at)}` : ''}`);
    }
    return value;
  });
  const state = errors ? 'error' : pending ? 'pending' : passed && failed ? 'mixed' : passed ? 'pass' : 'fail';
  const status = errors ? `缺数据${entries.length > 1 ? ` ${errors}/${entries.length}` : ''}`
    : pending ? `待计算${entries.length > 1 ? ` ${pending}/${entries.length}` : ''}`
    : state === 'mixed' ? `满足 ${passed}/${entries.length}` : passed ? '满足' : '不满足';
  return { value: qualityTableRange(values, qualityFilterValueText), state, status, detail: details.join('\n') };
}
