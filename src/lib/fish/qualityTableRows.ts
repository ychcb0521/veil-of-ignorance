import { signalDedupKey } from '@/lib/signalLibrary';
import type { QualitySample } from './quality';
import { fishCaptureTime, qualityOrigins } from './qualitySources';

/** Display-only grouping by signal and buy time. Preserve every entry, source and detector ID for execution and selection. */
export interface QualityTableRow extends QualitySample { members?: QualitySample[] }
export const qualityTableMembers = (row: QualityTableRow): QualitySample[] => row.members ?? [row];
export function qualityTableCaptureTime(row: QualityTableRow): number | null {
  let latest: number | null = null;
  for (const member of qualityTableMembers(row)) {
    const at = Math.max(member.minedAt ?? 0, fishCaptureTime(member.source) ?? 0) || null;
    if (at !== null && (latest === null || at > latest)) latest = at;
  }
  return latest;
}
export const qualityTableSignalKey = (row: QualitySample) => signalDedupKey(row.source);
export function collapseQualityTableRows(rows: readonly QualitySample[]): QualityTableRow[] {
  const grouped = new Map<string, QualityTableRow>();
  for (const row of rows) {
    // 【用户要求】2026-11-02 不显示区间：同一信号不同时间的买入各占一行（结果各不相同）；同一次买入的多个探测行仍合成一行（共用同一份监测结果）
    const key = `${qualityTableSignalKey(row)}|${row.enteredAt ?? ''}`, previous = grouped.get(key);
    if (previous) {
      previous.members!.push(row);
      previous.groups = [...new Set([...previous.groups, ...row.groups])];
      previous.origins=[...new Set([...qualityOrigins(previous),...qualityOrigins(row)])];previous.origin=previous.origins.length===1?previous.origins[0]:undefined;
    } else grouped.set(key, { ...row, id: `merged:${key}`, detectorId: undefined, groups: [...row.groups], members: [row] });
  }
  return [...grouped.values()];
}
/** Never make a missing result look like a measured zero or silently select one of several entries. */
export function qualityTableRange(values: readonly (number | null | undefined)[], format: (value: number) => string): string {
  if (!values.length || values.some(value => value == null || !Number.isFinite(value))) return '—';
  const valid = values as readonly number[], low = Math.min(...valid), high = Math.max(...valid);
  const a = format(low), b = format(high);
  return a === b ? a : `${a}～${b}`;
}
