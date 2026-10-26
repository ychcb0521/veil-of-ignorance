import { signalDedupKey } from '@/lib/signalLibrary';
import type { QualitySample } from './quality';

/** Display-only grouping. Preserve every entry, source and detector ID for execution and selection. */
export interface QualityTableRow extends QualitySample { members?: QualitySample[] }
export const qualityTableMembers = (row: QualityTableRow): QualitySample[] => row.members ?? [row];
export const qualityTableSignalKey = (row: QualitySample) => signalDedupKey(row.source);
export function collapseQualityTableRows(rows: readonly QualitySample[]): QualityTableRow[] {
  const grouped = new Map<string, QualityTableRow>();
  for (const row of rows) {
    const key = qualityTableSignalKey(row), previous = grouped.get(key);
    if (previous) {
      previous.members!.push(row);
      previous.groups = [...new Set([...previous.groups, ...row.groups])];
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
