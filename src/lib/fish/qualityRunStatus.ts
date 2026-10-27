import { activeBuyFilters, hasQualityExit, qualityFilterReadingKey, qualityFilterStatus, qualityResultKey, type FishQualityStudy, type QualitySample } from './quality';
import { qualityTableMembers, type QualityTableRow } from './qualityTableRows';

export type QualityRunStage = 'filter' | 'monitor';
export type QualityRunStateFilter = '' | 'pending' | 'done';
export interface QualityStageStatus { total: number; finished: number; errors: number; refreshable: number; complete: boolean }
export type QualityEntryRunStatus = Record<QualityRunStage, QualityStageStatus>;
const empty = (): QualityStageStatus => ({ total: 0, finished: 0, errors: 0, refreshable: 0, complete: false });
export const qualityRunStatusText = (status: QualityStageStatus) => !status.total ? '未设置' : status.complete ? '已经运行' : '尚未运行';
export const qualityRunStatusDetail = (status: QualityStageStatus) => !status.total ? '尚未配置本项运行条件' : [
  `当前条件下有效完成 ${status.finished}/${status.total} 项`,
  status.errors ? `${status.errors} 项缺数据，待补算` : '',
  status.refreshable ? `${status.refreshable} 项仍在持有，可继续监测补充新行情` : '',
].filter(Boolean).join('；');

/** Derived from current parameter keys and usable results, never from a stale "clicked start" flag. */
export function qualityRunStatusMap(study: FishQualityStudy, rows: readonly QualitySample[]): Map<string, QualityEntryRunStatus> {
  const readings = new Map((study.filterReadings ?? []).map(r => [r.key, r])), results = new Map(study.results.map(r => [r.key, r]));
  const plans = study.sellPlans ?? [], statuses = new Map<string, QualityEntryRunStatus>();
  for (const row of rows) {
    const id = row.signalId ?? row.id;
    if (statuses.has(id)) continue;
    const filter = empty(), monitor = empty(), seen = new Set<string>();
    for (const plan of plans) {
      const conditions = activeBuyFilters(study, plan);
      let known = true;
      for (const condition of conditions) {
        const key = qualityFilterReadingKey(row, condition), reading = readings.get(key), valid = !!reading && !reading.error && Number.isFinite(reading.value);
        if (!valid) known = false;
        if (seen.has(key)) continue;
        seen.add(key); filter.total++;
        if (valid) filter.finished++;
        else if (reading) filter.errors++;
      }
      if (!hasQualityExit(plan)) continue;
      monitor.total++;
      if (!known) continue;
      // Non-bought entries need no sell simulation, except the explicitly fixed detector comparison.
      if (plan.id !== study.selectedSellId && qualityFilterStatus(study, row, plan, readings).state === 'fail') { monitor.finished++; continue; }
      const result = results.get(qualityResultKey(row, plan, study.observeHours));
      if (result && (result.status === 'closed' || result.status === 'open') && Number.isFinite(result.returnPct)) {
        monitor.finished++;
        if (result.status === 'open' && !result.complete) monitor.refreshable++;
      } else if (result?.status === 'error') monitor.errors++;
    }
    filter.complete = filter.total > 0 && filter.finished === filter.total;
    monitor.complete = monitor.total > 0 && monitor.finished === monitor.total;
    statuses.set(id, { filter, monitor });
  }
  return statuses;
}
export function qualityRowRunStatus(row: QualityTableRow, statuses: ReadonlyMap<string, QualityEntryRunStatus>): QualityEntryRunStatus {
  const entries = [...new Map(qualityTableMembers(row).map(r => [r.signalId ?? r.id, r])).keys()];
  const aggregate = (stage: QualityRunStage) => {
    const s = empty();
    for (const id of entries) { const part = statuses.get(id)?.[stage]; if (part) { s.total += part.total; s.finished += part.finished; s.errors += part.errors; s.refreshable += part.refreshable; } }
    s.complete = s.total > 0 && s.finished === s.total;
    return s;
  };
  return { filter: aggregate('filter'), monitor: aggregate('monitor') };
}
/** Select original entries, including only unfinished members of an otherwise merged display row. */
export function qualitySelectRunState(rows: readonly QualityTableRow[], statuses: ReadonlyMap<string, QualityEntryRunStatus>, stage: QualityRunStage, complete: boolean): string[] {
  return [...new Set(rows.flatMap(qualityTableMembers).filter(row => { const status = statuses.get(row.signalId ?? row.id)?.[stage]; return status && status.total > 0 && status.complete === complete; }).map(row => row.id))];
}
