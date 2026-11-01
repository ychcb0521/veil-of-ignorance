import { accountFeatureDefs } from '@/lib/featureSource';
import { loadQualityStudy, prepareQualityCampaignRead } from './qualityStore';
import { listQualityCampaignDataFromStudy, qualityCampaignDetailFromStudy, type QualityCampaignData } from './qualityCampaignProjection';
import type { QualityCampaignReadRequest, QualityCampaignReadResult } from './qualityCampaignReader';
export { buildQualityCampaignData, qualityDetectorCategory, qualityBuyFilterSummary, qualityCampaignDataFromStudy, qualityMonitorCampaignDataFromStudy } from './qualityCampaignProjection';
export type { QualityCampaignData } from './qualityCampaignProjection';

// Never hold two full IndexedDB snapshots at once, including list → detail navigation.
let reads: Promise<unknown> = Promise.resolve();
function projectInWorker(request: QualityCampaignReadRequest): Promise<QualityCampaignReadResult> {
  const task = reads.catch(() => undefined).then(() => new Promise<QualityCampaignReadResult>((resolve, reject) => {
    const worker = new Worker(new URL('../workers/qualityCampaignReader.worker.ts', import.meta.url), { type: 'module' });
    const finish = () => { clearTimeout(timer); worker.terminate(); };
    const timer = setTimeout(() => { finish(); reject(new Error('持仓监测读取超时，原数据仍保留，请重试')); }, 180_000);
    worker.onmessage = event => {
      finish();
      const reply = event.data;
      if (reply.ok) resolve(reply.result);
      else reject(new Error(reply.error || '持仓监测读取失败，原数据仍保留，请重试'));
    };
    worker.onerror = event => {
      console.error('持仓监测读取 Worker 失败', event.message, event.filename, event.lineno);
      finish(); reject(new Error('持仓监测读取失败，原数据仍保留，请重试'));
    };
    try { worker.postMessage(request); } catch (error) { finish(); reject(error); }
  }));
  reads = task.then(() => undefined, () => undefined);
  return task;
}
export async function listQualityCampaignData(owner: string, section: 'sell' | 'detect' | 'quality' = 'quality') {
  if (typeof Worker === 'function') {
    const prepared = await prepareQualityCampaignRead(owner);
    if (prepared.durable) {
      const result = await projectInWorker({ owner, kind: 'list', section, definitions: accountFeatureDefs(), warning: prepared.warning });
      if (result.kind !== 'list') throw new Error('持仓监测读取结果不匹配');
      return { ...result.data, warning: prepared.warning };
    }
  }
  const loaded = await loadQualityStudy(owner);
  return { ...listQualityCampaignDataFromStudy(owner, loaded.study, section), warning: loaded.warning };
}
export async function loadQualityCampaignData(owner: string, id: string): Promise<QualityCampaignData> {
  if (typeof Worker === 'function') {
    const prepared = await prepareQualityCampaignRead(owner);
    if (prepared.durable) {
      const result = await projectInWorker({ owner, kind: 'detail', id, warning: prepared.warning });
      if (result.kind !== 'detail') throw new Error('持仓监测读取结果不匹配');
      return result.data;
    }
  }
  return qualityCampaignDetailFromStudy(owner, (await loadQualityStudy(owner)).study, id);
}
