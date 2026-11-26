import {staticTimeSample} from './qualityFilterTime';
import {qualityMonitorTimeLabels,qualitySignalTime} from './qualityAdmissionTime';
import { formatUTC8 } from '@/lib/timeFormat';
import { staticDblDistanceKeyParts, activeStandaloneBuyFilters, activeBuyFilters, qualityFilterReadingKey, type FishQualityStudy, type QualityBuyFilter, type QualityFilterReading, type QualitySample } from './quality';
import { qualityTableMembers, qualityTableRange, type QualityTableRow } from './qualityTableRows';

export interface QualityFilterColumn { id: string; filter: QualityBuyFilter; plans: string[] }
/** Equal conditions share a column, while different thresholds/formulas remain distinguishable. */
export function qualityFilterColumns(study: FishQualityStudy): QualityFilterColumn[] {
  const columns = new Map<string, QualityFilterColumn>();
  const sources = study.independentFilters ? [{label:'',filters:activeStandaloneBuyFilters(study)}] : (study.sellPlans ?? []).map(plan=>({label:plan.label,filters:activeBuyFilters(study,plan)}));
  for (const plan of sources) for (const filter of plan.filters) {
    const id = JSON.stringify([filter.snapshot.definitionKey, filter.metric, filter.snapshot.interval, filter.direction, filter.threshold, ...(filter.initialization ? [filter.initialization] : []), ...staticDblDistanceKeyParts(filter)]);
    const previous = columns.get(id);
    if (previous) { if (plan.label && !previous.plans.includes(plan.label)) previous.plans.push(plan.label); }
    else columns.set(id, { id, filter, plans: plan.label ? [plan.label] : [] });
  }
  return [...columns.values()];
}
export const qualityFilterValueText = (value: number) => String(+value.toPrecision(8));
export function qualityFilterValue(row: QualitySample, filter: QualityBuyFilter, readings: ReadonlyMap<string, QualityFilterReading>, times?:FishQualityStudy['staticTimeByEntry']): number | null {
  row=staticTimeSample(row,times);
  const reading = readings.get(qualityFilterReadingKey(row, filter));
  return reading && !reading.error && Number.isFinite(reading.value) ? reading.value! : null;
}
/** Render all original entries in a merged row; never make missing readings look like zero. */
export function qualityFilterCell(row: QualityTableRow, filter: QualityBuyFilter, readings: ReadonlyMap<string, QualityFilterReading>, times?:FishQualityStudy['staticTimeByEntry']) {
  const entries = [...new Map(qualityTableMembers(row).map(member=>staticTimeSample(member,times)).map(member => [qualityFilterReadingKey(member, filter), member])).values()];
  let passed = 0, failed = 0, pending = 0, errors = 0, skipped = 0;
  const details: string[] = [];
  const values = entries.map(entry => {
    const reading = readings.get(qualityFilterReadingKey(entry, filter)), value = qualityFilterValue(entry, filter, readings);
    if (entry.staticTime?.at === null) { skipped++; details.push(qualityMonitorTimeLabels[entry.staticTime.basis]+'缺失，本轮跳过'); return null; }
    const prefix = entry.staticTime ? qualityMonitorTimeLabels[entry.staticTime.basis]+' '+formatUTC8(entry.staticTime.at!) : filter.signalGuardAtr !== undefined ? '信号 '+formatUTC8(qualitySignalTime(entry.source)) : `买入 ${entry.enteredAt ? formatUTC8(entry.enteredAt) : '时间缺失'}`;
    if (!reading) { pending++; details.push(`${prefix}：待计算`); }
    else if (value == null) { errors++; details.push(`${prefix}：${reading.error ?? '读数无效'}`); }
    else {
      const ok = filter.direction === '>' ? value > filter.threshold : value < filter.threshold;
      if (ok) passed++; else failed++;
      details.push(`${prefix}：${value} ${ok ? '满足' : '不满足'} ${filter.direction} ${filter.threshold}${reading.at ? `；读数截止 ${formatUTC8(reading.at)}` : ''}`);
    }
    return value;
  });
  const state = skipped===entries.length ? 'skipped' : errors ? 'error' : pending ? 'pending' : passed && failed ? 'mixed' : passed ? 'pass' : 'fail';
  const status = skipped===entries.length ? '已跳过' : errors ? `缺数据${entries.length > 1 ? ` ${errors}/${entries.length}` : ''}`
    : pending ? `待计算${entries.length > 1 ? ` ${pending}/${entries.length}` : ''}`
    : state === 'mixed' ? `满足 ${passed}/${entries.length}` : passed ? '满足' : '不满足';
  return { value: qualityTableRange(values, value => filter.staticDblDistance || filter.signalGuardAtr !== undefined ? value.toFixed(2) + '%' : qualityFilterValueText(value)), state, status:skipped && skipped<entries.length ? status+' · 跳过 '+skipped : status, detail: details.join('\n') };
}
