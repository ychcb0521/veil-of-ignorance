import { newQualityStudy, type QualitySample } from './quality';
import type { BrowseRow, BrowseScope } from './libraryBrowse';
import { EXCHANGE_PRIORITY, type FishExchange } from './exchanges';

/** Copy the selected directory information without reading or reconstructing its archive. */
export function browseInformationStudy(scope: BrowseScope, directoryId: string, rows: readonly BrowseRow[]) {
  const study = newQualityStudy();
  study.samples = rows.map(([symbol, timeMs, detail, recordId, detectors]): QualitySample => {
    let identity: unknown;
    try { identity = JSON.parse(recordId); } catch { /* Some directories use opaque record IDs. */ }
    // Filter record IDs already contain their original venue, signal and entry times.
    const parts = Array.isArray(identity) && identity.length === 7 && identity[4] === symbol && identity[5] === timeMs ? identity : undefined;
    const exchange = parts && EXCHANGE_PRIORITY.includes(parts[1]) ? parts[1] as FishExchange : undefined;
    const enteredAt = parts && (parts[6] === null || Number.isFinite(parts[6])) ? parts[6] as number | null : null;
    return {
      id: `directory:${scope}:${directoryId}:${recordId}`,
      source: { id: recordId, symbol, timeMs, timeLabel: '', fallbackZone: '',
        ...(exchange ? {exchange} : {}),
        ...(parts?.[2] === 'us_stock' ? {market: 'us_stock' as const, underlying: String(parts[3])} : {}),
      },
      enteredAt, basis: enteredAt === null ? 'missing' : 'capture', groups: [], importedAt: study.startedAt,
      directoryInformation: {scope, directoryId, recordId, detail, ...(detectors ? {detectors: structuredClone(detectors)} : {})},
    };
  });
  return study;
}
