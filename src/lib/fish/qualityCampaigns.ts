import { accountFeatureDefs } from '@/lib/featureSource';
import { loadQualityStudy, prepareQualityCampaignRead } from './qualityStore';
import { listQualityCampaignDataFromStudy, qualityCampaignDetailFromStudy, type QualityCampaignData } from './qualityCampaignProjection';
import type { QualityCampaignReadRequest, QualityCampaignReadResult } from './qualityCampaignReader';
import { paperCampaignPerformance, qualityCampaignPerformanceFromStudy } from './qualityCampaignPerformance';
import { serializeArchiveWork } from '../serializeArchiveWork';
import {QualityCampaignPacketDecoder,type QualityCampaignReply} from './qualityCampaignTransfer';
import { campaignSectionLabel, isInstantCampaignId, qualityCampaignTrashKey } from '@/lib/campaignSections';
import { loadQualityCampaignTrash, readQualityCampaignTrash } from './qualityCampaignTrash';
import { buildInstantCampaignData } from './instantCampaign';
import { listInstantCampaignSnapshots, loadInstantCampaignSnapshot, readLocalInstantCampaignSnapshots } from './instantCampaignStore';
export { buildQualityCampaignData, qualityDetectorCategory, qualityBuyFilterSummary, qualityCampaignDataFromStudy, qualityMonitorCampaignDataFromStudy } from './qualityCampaignProjection';
export type { QualityCampaignData } from './qualityCampaignProjection';

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
export async function listLocalInstantCampaignData(owner: string) {
  return (await readLocalInstantCampaignSnapshots(owner)).map(snapshot => buildInstantCampaignData(owner, snapshot));
}

export async function listQualityCampaignData(owner: string, section: 'sell' | 'detect' | 'quality' | 'instant' = 'quality',signal?:AbortSignal) {
  if (section === 'instant') {
    const { snapshots, warning } = await listInstantCampaignSnapshots(owner, signal);
    return { rows: snapshots.map(snapshot => buildInstantCampaignData(owner, snapshot)), warning,
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
export async function loadQualityCampaignData(owner: string, id: string): Promise<QualityCampaignData> {
  const instant = isInstantCampaignId(id), section = instant ? 'instant' : 'quality';
  const missing = '这场' + campaignSectionLabel(section) + '战役已永久移除';
  const initialMarks = await loadQualityCampaignTrash(owner, section);
  if (initialMarks[qualityCampaignTrashKey(id)]?.state === 'purged') {
    throw new Error(missing);
  }
  const applyTrash = async (data: QualityCampaignData) => {
    const marks = await readQualityCampaignTrash(owner, section);
    const mark = marks[qualityCampaignTrashKey(data.campaign.id)];
    if (mark?.state === 'purged' || marks[qualityCampaignTrashKey(id)]?.state === 'purged') {
      throw new Error(missing);
    }
    return mark?.state === 'deleted'
      ? { ...data, campaign: { ...data.campaign, deleted_at: new Date(mark.at).toISOString() } }
      : data;
  };
  if (instant) return applyTrash(buildInstantCampaignData(owner, await loadInstantCampaignSnapshot(owner, id)));
  if (typeof Worker === 'function') {
    const prepared = await prepareQualityCampaignRead(owner);
    if (prepared.durable) {
      const result = await projectInWorker({ owner, kind: 'detail', id, warning: prepared.warning });
      if (result.kind !== 'detail') throw new Error('持仓监测读取结果不匹配');
      return applyTrash(result.data);
    }
  }
  return applyTrash(qualityCampaignDetailFromStudy(owner, (await loadQualityStudy(owner)).study, id));
}
export async function loadQualityCampaignPerformance(owner: string, section: 'sell' | 'detect' | 'quality' | 'instant', sellKey: string) {
  const trash = await loadQualityCampaignTrash(owner, section === 'instant' ? 'instant' : 'quality');
  const excluded = Object.keys(trash).filter(key => trash[key].state !== 'active');
  if (section === 'instant') {
    const { rows, warning } = await listQualityCampaignData(owner, section);
    if (warning && !rows.length) throw Error(warning);
    return paperCampaignPerformance(rows, excluded);
  }
  if (typeof Worker === 'function') {
    const prepared = await prepareQualityCampaignRead(owner);
    if (prepared.durable) {
      const result = await projectInWorker({ owner, kind: 'performance', section, sellKey, warning: prepared.warning, ...(excluded.length ? { excluded } : {}) });
      if (result.kind !== 'performance') throw new Error('持仓监测统计结果不匹配');
      return result.data;
    }
  }
  return qualityCampaignPerformanceFromStudy(owner, (await loadQualityStudy(owner)).study, section, sellKey, excluded);
}
