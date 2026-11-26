import { accountFeatureDefs } from '@/lib/featureSource';
import { loadQualityStudy, prepareQualityCampaignRead } from './qualityStore';
import { listQualityCampaignDataFromStudy, qualityCampaignDetailFromStudy, type QualityCampaignData } from './qualityCampaignProjection';
import { readQualityCampaignProjection, withStoredQualityCampaignStudy, type QualityCampaignReadRequest, type QualityCampaignReadResult } from './qualityCampaignReader';
import { mergeQualityWorkspaceExecution } from './qualityWorkspaceExecutionMerge';
import { paperCampaignPerformance, qualityCampaignPerformanceFromStudy } from './qualityCampaignPerformance';
import { serializeArchiveWork } from '../serializeArchiveWork';
import {QualityCampaignPacketDecoder,type QualityCampaignReply} from './qualityCampaignTransfer';
import { campaignSectionLabel, isInstantCampaignId, qualityCampaignTrashKey } from '@/lib/campaignSections';
import { loadQualityCampaignTrash, readQualityCampaignTrash } from './qualityCampaignTrash';
import { instantCampaignMetadata } from './instantCampaignMetadata';
import { readAutomaticPreEntrySales } from './preEntryPersistence';
import { qualitySignalTime } from './qualityAdmissionTime';
import { readInstantPositionProgress } from './instantPositionProgress';
import { buildInstantCampaignData, buildOpenInstantCampaignData, buildSettlingInstantCampaignData, type InstantCampaignInput } from './instantCampaign';
import { instantMonitorSize } from './instantMonitorExecution';
import { listInstantCampaignSnapshots, loadInstantCampaignSnapshot, readInstantCampaignJob, readLocalInstantCampaignJobs } from './instantCampaignStore';
import { linkedUsdtEntryRiskPct } from './usdtLiveCampaignMetrics';
import { isUsdtLiveCampaignId } from './usdtLiveCampaign';
import { buildUsdtLiveCampaignData, mergeUsdtLiveCampaignRows } from './usdtLiveCampaignProjection';
import { listCloudUsdtCampaigns, loadUsdtCampaign, readUsdtCampaigns } from './usdtLiveCampaignStore';
export { buildQualityCampaignData, qualityDetectorCategory, qualityBuyFilterSummary, qualityCampaignDataFromStudy, qualityMonitorCampaignDataFromStudy } from './qualityCampaignProjection';
export type { QualityCampaignData } from './qualityCampaignProjection';

function throwIfReadAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('读取已取消', 'AbortError');
}

async function loadCampaignStudy(owner: string) {
  const loaded = await loadQualityStudy(owner);
  if (typeof indexedDB === 'undefined') return loaded;
  const study = await withStoredQualityCampaignStudy({ owner, kind: 'list', section: 'quality', definitions: [], workspaceOnly: true },
    working => working.workspaceExecution === 1 ? mergeQualityWorkspaceExecution(loaded.study, working) : loaded.study);
  return { ...loaded, study };
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
function projectPendingTemplateSale(owner: string, sale: InstantCampaignInput) {
  const entryPrice = sale.monitorResult?.entryPrice;
  if (!sale.monitor || entryPrice == null || !Number.isFinite(entryPrice) || entryPrice <= 0) return;
  return buildSettlingInstantCampaignData(owner, { ...sale, ...instantMonitorSize(sale.monitor, sale.instantPosition), entryPrice }, sale);
}

export async function listLocalInstantCampaignData(owner: string) {
  const [jobs, live] = await Promise.all([readLocalInstantCampaignJobs(owner), readUsdtCampaigns(owner).catch(() => [])]);
  const openJobs = jobs.filter(job => job.opened && !job.snapshot);
  const progress = await readInstantPositionProgress(owner, openJobs.map(job => job.input.recordId));
  const progressById = new Map(openJobs.map((job, index) => [job.input.id, progress[index]]));
  const paper = jobs.flatMap(job => {
    if (job.snapshot) return [buildInstantCampaignData(owner, job.snapshot)];
    const saved = progressById.get(job.input.id);
    const position = job.opened;
    const sale = 'sell' in job.input ? job.input
      : position && saved?.alert ? { ...position, sell: saved.alert, monitorResult: saved.monitorResult } : undefined;
    if (sale) {
      const settling = position ? buildSettlingInstantCampaignData(owner, position, sale) : projectPendingTemplateSale(owner, sale);
      return settling ? [settling] : [];
    }
    if (!position || saved?.monitorResult?.status === 'closed') return [];
    return [buildOpenInstantCampaignData(owner, position, saved?.monitorResult, saved?.risk?.mirror, saved?.risk?.through, saved?.manual)];
  });
  return mergeUsdtLiveCampaignRows([...paper, ...live.map(({ campaign }) => buildUsdtLiveCampaignData(owner, campaign))]);
}

export async function listQualityCampaignData(owner: string, section: 'sell' | 'detect' | 'quality' | 'instant' = 'quality',signal?:AbortSignal,
  onLocal?: (data: ReturnType<typeof listQualityCampaignDataFromStudy>) => void) {
  if (section === 'instant') {
    const [{ snapshots, warning }, live] = await Promise.all([listInstantCampaignSnapshots(owner, signal),
      listCloudUsdtCampaigns(owner, signal).catch(() => undefined)]);
    const closedIds = new Set(snapshots.map(snapshot => snapshot.id));
    const local = await listLocalInstantCampaignData(owner).catch(() => []);
    const rows = mergeUsdtLiveCampaignRows([...(live ?? []).map(campaign => buildUsdtLiveCampaignData(owner, campaign)),
      ...snapshots.map(snapshot => buildInstantCampaignData(owner, snapshot)), ...local.filter(data => !closedIds.has(data.campaign.id))]);
    return { rows, warning: warning ?? (live ? undefined : '币安实盘战役云端暂未读完'),
      selectedSellKey: undefined, buyFilterLabel: '', repair: undefined };
  }
  if(signal?.aborted)throw new DOMException('读取已取消','AbortError');
  if (onLocal && (typeof Worker === 'function' || typeof indexedDB !== 'undefined')) {
    const request: QualityCampaignReadRequest = { owner, kind: 'list', section, definitions: accountFeatureDefs(), workspaceOnly: true };
    const local = await (typeof Worker === 'function' ? projectInWorker(request, signal) : readQualityCampaignProjection(request));
    throwIfReadAborted(signal);
    if (local.kind !== 'list') throw new Error('持仓监测读取结果不匹配');
    onLocal(local.data);
  }
  if (typeof Worker === 'function') {
    const prepared = await prepareQualityCampaignRead(owner);
    if (prepared.durable) {
      const result = await projectInWorker({ owner, kind: 'list', section, definitions: accountFeatureDefs(), warning: prepared.warning },signal);
      if (result.kind !== 'list') throw new Error('持仓监测读取结果不匹配');
      return { ...result.data, warning: prepared.warning };
    }
  }
  if(signal?.aborted)throw new DOMException('读取已取消','AbortError');
  const loaded = await loadCampaignStudy(owner);
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
    if (isUsdtLiveCampaignId(id)) {
      const real = await loadUsdtCampaign(owner, id, signal);
      let entryRiskPct: number | null | undefined;
      if (real.followId && isInstantCampaignId(real.followId) && !isUsdtLiveCampaignId(real.followId)) {
        // Only the exact opening snapshot is needed. A paper row's later visibility does not change entry risk.
        const job = await readInstantCampaignJob(owner, real.followId).catch(() => undefined);
        throwIfReadAborted(signal);
        const snapshot = job?.snapshot ?? (!job?.opened
          ? await loadInstantCampaignSnapshot(owner, real.followId, signal, job).catch(() => undefined) : undefined);
        const linked = snapshot ? buildInstantCampaignData(owner, snapshot)
          : job?.opened ? buildOpenInstantCampaignData(owner, job.opened) : undefined;
        entryRiskPct = linkedUsdtEntryRiskPct(real, owner, linked?.campaign);
      }
      return applyTrash(buildUsdtLiveCampaignData(owner, real, entryRiskPct));
    }
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
    if (job && 'sell' in job.input && !job.snapshot) {
      const settling = projectPendingTemplateSale(owner, job.input);
      if (settling) return applyTrash(settling);
    }
    const frozen = job?.snapshot ?? await loadInstantCampaignSnapshot(owner, id, signal, job);
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
  // Resolve the working trade before synchronizing or downloading legacy history.
  if (typeof Worker === 'function' || typeof indexedDB !== 'undefined') {
    const request: QualityCampaignReadRequest = { owner, kind: 'detail', id, workspaceOnly: true };
    const local = await (typeof Worker === 'function' ? projectInWorker(request, signal) : readQualityCampaignProjection(request));
    throwIfReadAborted(signal);
    if (local.kind === 'detail') return applyTrash(local.data);
    if (local.kind !== 'missing') throw new Error('持仓监测读取结果不匹配');
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
  const { study } = await loadCampaignStudy(owner);
  throwIfReadAborted(signal);
  return applyTrash(qualityCampaignDetailFromStudy(owner, study, id));
}
export async function loadQualityCampaignPerformance(owner: string, section: 'sell' | 'detect' | 'quality' | 'instant', sellKey: string, signal?: AbortSignal) {
  throwIfReadAborted(signal);
  const trash = await loadQualityCampaignTrash(owner, section === 'instant' ? 'instant' : 'quality');
  throwIfReadAborted(signal);
  const excluded = Object.keys(trash).filter(key => trash[key].state !== 'active');
  if (section === 'instant') {
    const { rows, warning } = await listQualityCampaignData(owner, 'instant', signal);
    throwIfReadAborted(signal);
    if (warning && !rows.length) throw Error(warning);
    return paperCampaignPerformance(rows, excluded);
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
  const { study } = await loadCampaignStudy(owner);
  throwIfReadAborted(signal);
  return qualityCampaignPerformanceFromStudy(owner, study, section, sellKey, excluded);
}
