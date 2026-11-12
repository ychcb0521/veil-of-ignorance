import type { FishQualityStudy } from './quality';

type WorkspaceData = Pick<FishQualityStudy, 'samples' | 'selectedRowIds' | 'workspaceUpdatedAt' | 'workspaceMonitorDraft'>;
export function qualityWorkspaceData(study: WorkspaceData): WorkspaceData {
  const { samples, selectedRowIds, workspaceUpdatedAt, workspaceMonitorDraft } = study;
  return { samples, selectedRowIds, workspaceUpdatedAt, workspaceMonitorDraft };
}

export function preserveQualityWorkspace(saved: WorkspaceData | undefined, incoming: FishQualityStudy): FishQualityStudy {
  return saved?.workspaceUpdatedAt && saved.workspaceUpdatedAt >= (incoming.workspaceUpdatedAt ?? 0)
    ? { ...incoming, ...qualityWorkspaceData(saved) } : incoming;
}

type SavedSignalReadings = Pick<FishQualityStudy, 'signalMetrics' | 'signalMetricsUpdatedAt' | 'signalReadings'>;

export const signalReadingsStorageKey = (studyKey: string) => studyKey + ':signal-readings';

export function preserveQualitySignalReadings<T extends SavedSignalReadings>(saved: SavedSignalReadings | undefined, incoming: T): T {
  if (!saved?.signalMetricsUpdatedAt && !saved?.signalReadings?.length) return incoming;
  const columns = (saved.signalMetricsUpdatedAt ?? 0) > (incoming.signalMetricsUpdatedAt ?? 0) ? saved : incoming;
  const readings = new Map(saved.signalReadings?.map(reading => [reading.key, reading]));
  for (const reading of incoming.signalReadings ?? []) {
    const previous = readings.get(reading.key);
    if (!previous || !reading.error && Number.isFinite(reading.value) || previous.error) readings.set(reading.key, reading);
  }
  return {...incoming,...(columns.signalMetricsUpdatedAt ? {signalMetrics:columns.signalMetrics,signalMetricsUpdatedAt:columns.signalMetricsUpdatedAt} : {}),
    ...(readings.size ? {signalReadings:[...readings.values()]} : {})};
}

export function readStoredQualityWithSignalReadings(store: IDBObjectStore, key: string): Promise<unknown> {
  return new Promise((resolve,reject) => {
    const main = store.get(key), readings = store.get(signalReadingsStorageKey(key)), workspace = store.get(key + ':workspace');
    main.onerror = () => reject(main.error);
    readings.onerror = () => reject(readings.error);
    workspace.onerror = () => reject(workspace.error);
    workspace.onsuccess = () => resolve(main.result && typeof main.result === 'object' ? preserveQualityWorkspace(workspace.result,preserveQualitySignalReadings(readings.result,main.result)) : main.result);
  });
}

export function writeStoredQualityWithSignalReadings(store: IDBObjectStore, key: string, study: FishQualityStudy) {
  const {signalMetrics,signalMetricsUpdatedAt,signalReadings} = study;
  // Older tabs can still write the study row. This sibling record keeps the new readings recoverable.
  if (signalMetricsUpdatedAt || signalReadings?.length) store.put({signalMetrics,signalMetricsUpdatedAt,signalReadings},signalReadingsStorageKey(key));
  if (study.workspaceUpdatedAt) store.put(qualityWorkspaceData(study),key + ':workspace');
  store.put(study,key);
}
