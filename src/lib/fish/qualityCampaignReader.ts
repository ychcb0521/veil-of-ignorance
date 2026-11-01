import type { DeepDigFeatureDef } from '@/lib/deepDig/features';
import { applySourceDeletions } from './libraryDeletion';
import { newQualityStudy, type FishQualityStudy } from './quality';
import { listQualityCampaignDataFromStudy, qualityCampaignDetailFromStudy, type QualityCampaignData } from './qualityCampaignProjection';
import { stopQualityRepair } from './qualityRepair';

export type QualityCampaignReadRequest = { owner: string; warning?: string } & (
  | { kind: 'list'; section: 'sell' | 'detect' | 'quality'; definitions: readonly DeepDigFeatureDef[] }
  | { kind: 'detail'; id: string }
);
export type QualityCampaignReadResult =
  | { kind: 'list'; data: ReturnType<typeof listQualityCampaignDataFromStudy> }
  | { kind: 'detail'; data: QualityCampaignData };

/** Only derived campaign data crosses the worker boundary. Frozen tables stay on disk. */
export function projectQualityCampaignStudy(study: FishQualityStudy, request: QualityCampaignReadRequest): QualityCampaignReadResult {
  const active = { ...study, monitorLibrary: study.monitorLibrary && { ...study.monitorLibrary, archives: undefined } };
  const clean = stopQualityRepair(applySourceDeletions(active), Date.now());
  return request.kind === 'list'
    ? { kind: 'list', data: listQualityCampaignDataFromStudy(request.owner, clean, request.section, request.definitions) }
    : { kind: 'detail', data: qualityCampaignDetailFromStudy(request.owner, clean, request.id) };
}

/** Read the existing schema without ever copying the full study into the UI thread. */
export async function readQualityCampaignProjection(request: QualityCampaignReadRequest): Promise<QualityCampaignReadResult> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open('veil-fish-quality-v1', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('studies');
    open.onsuccess = () => resolve(open.result);
    open.onerror = open.onblocked = () => reject(new Error('持仓监测的本机存储暂不可用，请重试'));
  });
  try {
    const value = await new Promise<FishQualityStudy | undefined>((resolve, reject) => {
      const read = db.transaction('studies', 'readonly').objectStore('studies').get(`fish-quality:${request.owner}`);
      read.onsuccess = () => resolve(read.result);
      read.onerror = () => reject(new Error('持仓监测的本机记录读取失败，请重试'));
    });
    if (!value && request.warning) throw new Error(request.warning);
    if (value && (value.version !== 1 || !Array.isArray(value.samples) || !Array.isArray(value.groups) || !Array.isArray(value.results))) {
      throw new Error('持仓监测的本机记录格式异常，原数据仍保留，请重试');
    }
    if (request.warning && value && !value.samples.length && !value.results.length && !value.campaignRuns?.length
      && !value.monitorLibrary?.records.length && !value.filterLibrary?.records.length
      && !value.monitorLibrary?.rounds.length && !value.filterLibrary?.rounds.length && !value.monitorLibrary?.archives?.length
      && !value.entryReadings?.length && !value.postExitReadings?.length && !Object.keys(value.deletedSources ?? {}).length
      && !Object.keys(value.monitorLibrary?.directoryEdits ?? {}).length) throw new Error(request.warning);
    return projectQualityCampaignStudy(value ?? newQualityStudy(), request);
  } finally { db.close(); }
}
