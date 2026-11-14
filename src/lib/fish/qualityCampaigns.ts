import { accountFeatureDefs } from '@/lib/featureSource';
import { loadQualityStudy, prepareQualityCampaignRead } from './qualityStore';
import { listQualityCampaignDataFromStudy, qualityCampaignDetailFromStudy, type QualityCampaignData } from './qualityCampaignProjection';
import type { QualityCampaignReadRequest, QualityCampaignReadResult } from './qualityCampaignReader';
import { paperCampaignPerformance, qualityCampaignPerformanceFromStudy } from './qualityCampaignPerformance';
import { serializeArchiveWork } from '../serializeArchiveWork';
import {QualityCampaignPacketDecoder,type QualityCampaignReply} from './qualityCampaignTransfer';
import { campaignSectionLabel, isInstantCampaignId, qualityCampaignTrashKey } from '@/lib/campaignSections';
import { loadQualityCampaignTrash, readQualityCampaignTrash } from './qualityCampaignTrash';
import { instantCampaignMetadata } from './instantCampaignMetadata';
import { readAutomaticPreEntrySales } from './preEntryPersistence';
import { qualitySignalTime } from './qualityAdmissionTime';
import { readInstantPositionProgress } from './instantPositionProgress';
import { buildInstantCampaignData, buildOpenInstantCampaignData, buildSettlingInstantCampaignData, type InstantPositionFill } from './instantCampaign';
import { listInstantCampaignSnapshots, loadInstantCampaignSnapshot, readInstantCampaignJob, readLocalInstantCampaignSnapshots, readOpenInstantPositions } from './instantCampaignStore';
export { buildQualityCampaignData, qualityDetectorCategory, qualityBuyFilterSummary, qualityCampaignDataFromStudy, qualityMonitorCampaignDataFromStudy } from './qualityCampaignProjection';
export type { QualityCampaignData } from './qualityCampaignProjection';

function throwIfReadAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('读取已取消', 'AbortError');
}

// Campaign navigation, saves and cloud encoders share the renderer's memory.
// Their full IndexedDB snapshots must take turns across all of these features.
function projectInWorker(request: QualityCampaignReadRequest,signal?:AbortSignal): Promise<QualityCampaignReadResult> {
  return serializeArchiveWork(() => new Promise<QualityCampaignReadResult>((resolve, reject) => {
    if(signal?.aborted){reject(new DOMException('读取已取消','AbortError'));return;}
    const worker = new Worker(new URL('../workers/qualityCampaignReader.worker.ts', import.meta.url), { type: 'module' });
    const decoder=new QualityCampaignPacketDecoder();let settled=false,timer:ReturnType<typeof setTimeout>;
    const finish = () => { settled=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);worker.onmessage=null;worker.onerror=null;worker.onmessageerror=null;worker.terminate(); };
    const fail=(error:unknown)=>{if(!settled){finish();reject(error);}};
    const cancel=()=>fail(new DOMException('读取已取消','AbortError'));
    const arm=()=>{clearTimeout(timer);timer=setTimeout(()=>fail(new Error('持仓监测读取超时，原数据仍保留，请重试')),180_000);};
    signal?.addEventListener('abort',cancel,{once:true});arm();
    worker.onmessage = (event:MessageEvent<QualityCampaignReply>) => {
      if(settled)return;
      try{
        const reply=event.data;
        if(reply.type==='chunk'){decoder.push(reply);arm();worker.postMessage({type:'ack',sequence:reply.sequence});}
        else if(reply.type==='complete'){const result=decoder.finish();finish();resolve(result);}
        else if(reply.type==='error')fail(new Error(reply.error||'持仓监测读取失败，原数据仍保留，请重试'));
        else fail(new Error('持仓监测传输格式异常，原数据仍保留，请重试'));
      }catch(error){fail(error);}
    };
    worker.onerror = event => {
      console.error('持仓监测读取 Worker 失败', event.message, event.filename, event.lineno);
      fail(new Error('持仓监测读取失败，原数据仍保留，请重试'));
    };
    worker.onmessageerror=()=>fail(new Error('持仓监测传输未完成，原数据仍保留，请重试'));
    try { worker.postMessage(request); } catch (error) { fail(error); }
  }));
}
async function buildLocalOpenInstantData(owner: string, positions: InstantPositionFill[]) {
  if (!positions.length) return [];
  const progress = await readInstantPositionProgress(owner, positions.map(row => row.recordId));
  return positions.flatMap((position, index) => {
    const saved = progress[index];
    if (saved?.alert || saved?.monitorResult?.status === 'closed') return [];
    return [buildOpenInstantCampaignData(owner, position, saved?.monitorResult, saved?.risk?.mirror, saved?.risk?.through, saved?.manual)];
  });
}

export async function listLocalInstantCampaignData(owner: string) {
  const snapshots = await readLocalInstantCampaignSnapshots(owner);
  const open = await readOpenInstantPositions(owner);
  return [...snapshots.map(snapshot => buildInstantCampaignData(owner, snapshot)), ...await buildLocalOpenInstantData(owner, open)];
}

export async function listQualityCampaignData(owner: string, section: 'sell' | 'detect' | 'quality' | 'instant' = 'quality',signal?:AbortSignal) {
  if (section === 'instant') {
    const { snapshots, warning } = await listInstantCampaignSnapshots(owner, signal);
    const closedIds = new Set(snapshots.map(snapshot => snapshot.id));
    const open = (await readOpenInstantPositions(owner).catch(() => [])).filter(position => !closedIds.has(position.id));
    return { rows: [...snapshots.map(snapshot => buildInstantCampaignData(owner, snapshot)), ...await buildLocalOpenInstantData(owner, open)], warning,
      selectedSellKey: undefined, buyFilterLabel: '', repair: undefined };
  }
  if(signal?.aborted)throw new DOMException('读取已取消','AbortError');
  if (typeof Worker === 'function') {
    const prepared = await prepareQualityCampaignRead(owner);
    if (prepared.durable) {
      const result = await projectInWorker({ owner, kind: 'list', section, definitions: accountFeatureDefs(), warning: prepared.warning },signal);
      if (result.kind !== 'list') throw new Error('持仓监测读取结果不匹配');
      return { ...result.data, warning: prepared.warning };
    }
  }
  if(signal?.aborted)throw new DOMException('读取已取消','AbortError');
  const loaded = await loadQualityStudy(owner);
  return { ...listQualityCampaignDataFromStudy(owner, loaded.study, section), warning: loaded.warning };
}
export async function loadQualityCampaignData(owner: string, id: string, signal?: AbortSignal): Promise<QualityCampaignData> {
  throwIfReadAborted(signal);
  const instant = isInstantCampaignId(id), section = instant ? 'instant' : 'quality';
  const missing = '这场' + campaignSectionLabel(section) + '战役已永久移除';
  const initialMarks = await loadQualityCampaignTrash(owner, section);
  throwIfReadAborted(signal);
  if (initialMarks[qualityCampaignTrashKey(id)]?.state === 'purged') {
    throw new Error(missing);
  }
  const applyTrash = async (data: QualityCampaignData) => {
    throwIfReadAborted(signal);
    const marks = await readQualityCampaignTrash(owner, section);
    throwIfReadAborted(signal);
    const mark = marks[qualityCampaignTrashKey(data.campaign.id)];
    if (mark?.state === 'purged' || marks[qualityCampaignTrashKey(id)]?.state === 'purged') {
      throw new Error(missing);
    }
    return mark?.state === 'deleted'
      ? { ...data, campaign: { ...data.campaign, deleted_at: new Date(mark.at).toISOString() } }
      : data;
  };
  if (instant) {
    const job = await readInstantCampaignJob(owner, id);
    throwIfReadAborted(signal);
    if (!job?.snapshot && job?.opened) {
      const [saved] = await readInstantPositionProgress(owner, [job.opened.recordId]);
      const monitor = saved?.monitorResult?.status === 'open' ? saved.monitorResult : undefined;
      const mirror = saved?.risk?.mirror;
      const source = job.opened.source;
      const original = job.opened.metadata ? undefined : (await readAutomaticPreEntrySales(owner, [job.opened.recordId]).catch(() => []))
        .find(({ record }) => record.sample.source.symbol === source.symbol
          && (record.sample.source.exchange ?? 'binance') === (source.exchange ?? 'binance')
          && qualitySignalTime(record.sample.source) === source.timeMs && record.matchedAt === job.opened!.buyAt);
      const position = original ? { ...job.opened, metadata: instantCampaignMetadata(original.record, original.round) } : job.opened;
      const completed = await readInstantCampaignJob(owner, id);
      if (completed?.snapshot) return applyTrash(buildInstantCampaignData(owner, completed.snapshot));
      const sale = completed && 'sell' in completed.input ? completed.input
        : saved?.alert ? { ...position, sell: saved.alert, monitorResult: saved.monitorResult } : undefined;
      const settling = sale && buildSettlingInstantCampaignData(owner, position, sale);
      return applyTrash(settling ?? buildOpenInstantCampaignData(owner, position, monitor, mirror, saved?.risk?.through, saved?.manual));
    }
    const frozen = await loadInstantCampaignSnapshot(owner, id, signal, job);
    throwIfReadAborted(signal);
    if (frozen.metadata) return applyTrash(buildInstantCampaignData(owner, frozen));
    const saved = await readAutomaticPreEntrySales(owner, [frozen.recordId]).catch(() => []);
    throwIfReadAborted(signal);
    const original = saved.find(({ record }) => record.sample.source.symbol === frozen.source.symbol
      && (record.sample.source.exchange ?? 'binance') === (frozen.source.exchange ?? 'binance')
      && qualitySignalTime(record.sample.source) === frozen.source.timeMs && record.matchedAt === frozen.buyAt);
    const metadata = original ? instantCampaignMetadata(original.record, original.round) : undefined;
    return applyTrash(buildInstantCampaignData(owner, { ...frozen, metadata }));
  }
  if (typeof Worker === 'function') {
    const prepared = await prepareQualityCampaignRead(owner);
    if (prepared.durable) {
      const result = await projectInWorker({ owner, kind: 'detail', id, warning: prepared.warning }, signal);
      if (result.kind !== 'detail') throw new Error('持仓监测读取结果不匹配');
      return applyTrash(result.data);
    }
  }
  throwIfReadAborted(signal);
  const { study } = await loadQualityStudy(owner);
  throwIfReadAborted(signal);
  return applyTrash(qualityCampaignDetailFromStudy(owner, study, id));
}
export async function loadQualityCampaignPerformance(owner: string, section: 'sell' | 'detect' | 'quality' | 'instant', sellKey: string, signal?: AbortSignal) {
  throwIfReadAborted(signal);
  const trash = await loadQualityCampaignTrash(owner, section === 'instant' ? 'instant' : 'quality');
  throwIfReadAborted(signal);
  const excluded = Object.keys(trash).filter(key => trash[key].state !== 'active');
  if (section === 'instant') {
    const { snapshots, warning } = await listInstantCampaignSnapshots(owner, signal);
    throwIfReadAborted(signal);
    if (warning && !snapshots.length) throw Error(warning);
    return paperCampaignPerformance((function* () {
      for (const snapshot of snapshots) yield buildInstantCampaignData(owner, snapshot);
    })(), excluded);
  }
  if (typeof Worker === 'function') {
    const prepared = await prepareQualityCampaignRead(owner);
    if (prepared.durable) {
      const result = await projectInWorker({ owner, kind: 'performance', section, sellKey, warning: prepared.warning, ...(excluded.length ? { excluded } : {}) }, signal);
      if (result.kind !== 'performance') throw new Error('持仓监测统计结果不匹配');
      return result.data;
    }
  }
  throwIfReadAborted(signal);
  const { study } = await loadQualityStudy(owner);
  throwIfReadAborted(signal);
  return qualityCampaignPerformanceFromStudy(owner, study, section, sellKey, excluded);
}
