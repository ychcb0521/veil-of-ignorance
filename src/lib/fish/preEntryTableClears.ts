import type { PreEntryLibrary, PreEntryRecord } from './preEntryMonitor';

/** Display tombstones only. Never duplicate or delete the underlying audit. */
export type PreEntryTableClears = Record<string, number>;
export function validPreEntryTableClears(value: unknown): value is PreEntryTableClears {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.values(value).every(at => typeof at === 'number' && Number.isFinite(at) && at > 0);
}
export function mergePreEntryTableClears(...values: (PreEntryTableClears | undefined)[]): PreEntryTableClears {
  const marks = new Map<string, number>();
  for (const value of values) for (const [id, at] of Object.entries(value ?? {})) marks.set(id, Math.max(at, marks.get(id) ?? 0));
  return Object.fromEntries(marks);
}
export function clearedPreEntryRecord(record: PreEntryRecord, marks?: PreEntryTableClears): PreEntryRecord {
  const at = marks?.[record.id];
  return at > (record.tableClearedAt ?? 0) ? { ...record, tableClearedAt: at } : record;
}
export function withPreEntryTableClears(library: PreEntryLibrary, marks?: PreEntryTableClears): PreEntryLibrary {
  const tableClears = mergePreEntryTableClears(library.tableClears, marks);
  if (!Object.keys(tableClears).length) return library;
  return { ...library, tableClears, records: library.records.map(record => clearedPreEntryRecord(record, tableClears)) };
}
