import { mergeQualityPlanTemplates } from './qualityPlanTemplates';
import {preserveQualitySourceRatings,applyQualitySourceRatings} from './qualitySourceRatings';
import {applySavedQualityPlans,readSavedQualityPlans} from './qualitySavedPlans';
import {loadDurableQualityPlans} from './qualitySavedPlansStore';
import {preserveSourceDeletions,applySourceDeletions} from './libraryDeletion';
import { preserveQualityPostExit } from './qualityPostExit';
import { preserveQualityEntry } from './qualityEntry';
import { newQualityStudy, type FishQualityStudy } from './quality';
import { preserveQualityRepairs, stopQualityRepair } from './qualityRepair';
import { preserveQualityMonitorLibrary } from './qualityMonitorLibrary';
import { preserveQualityFilterLibrary } from './qualityFilterLibrary';
import { noteAccountBlobSaved, syncAccountBlobOnLoad, prepareAccountBlob, type AccountBlobAdapter } from '@/lib/accountBlobSync';
import {serializeArchiveWork} from '../serializeArchiveWork';
import {prepareStoredQuality} from './qualityBackup';
import {restorePreEntryStudy} from './preEntryArchive';
import { compactQualityStudyForStorage } from './qualityStudyCompact';
import { detachQualityArchiveBodies, qualityStudyHasInlineArchives, readStoredQualityArchiveResultCount, stripStoredQualityArchiveBodies, syncStoredQualityArchiveBodies, withoutQualityArchiveBodies } from './qualityArchiveStore';

const DATABASE = 'veil-fish-quality-v1', STORE = 'studies';
const keyOf = (owner?: string) => `fish-quality:${owner ?? 'anonymous'}`;
// 监测库、过滤库只增不减：旧标签页或只写修复的保存不能把它们抹掉。
const preserveLibraries = (saved: FishQualityStudy | undefined, incoming: FishQualityStudy) => preserveQualitySourceRatings(saved,preserveSourceDeletions(saved,preserveQualityEntry(saved,preserveQualityPostExit(saved,preserveQualityFilterLibrary(saved, preserveQualityMonitorLibrary(saved, incoming))))));
const preserveStudy = (saved: FishQualityStudy | undefined, incoming: FishQualityStudy) => {
  const next = preserveLibraries(saved, preserveQualityRepairs(saved, incoming));
  // 旧标签页或后台监测写回总表时，保留新存模板和删除墓碑。
  return { ...next, planTemplates: mergeQualityPlanTemplates(saved?.planTemplates, next.planTemplates) };
};
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
    const request = indexedDB.open(DATABASE, 1);
    let expired = false;
    const timer = setTimeout(() => { expired = true; reject(new Error('鱼质量存储超时')); }, 8_000);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => { clearTimeout(timer); if (expired) request.result.close(); else resolve(request.result); };
    request.onerror = request.onblocked = () => { clearTimeout(timer); reject(new Error('鱼质量存储不可用')); };
  });
}
function valid(value: unknown): value is FishQualityStudy {
  const v = value as FishQualityStudy;
  return v?.version === 1 && Number.isFinite(v.startedAt) && ['capture', 'signal'].includes(v.entryMode)
    && Number.isFinite(v.observeHours) && v.observeHours >= 0 && v.observeHours <= 8784 && typeof v.tracking === 'boolean'
    && Array.isArray(v.samples) && Array.isArray(v.groups) && Array.isArray(v.results);
}
/** 纠错已停用：读出来的记录一律先结束纠错（已核验的保留，其余恢复原样），见 stopQualityRepair。 */
const pendingReads = new Map<string, Promise<{ study: FishQualityStudy; warning?: string }>>();
export function loadQualityStudy(owner?: string): Promise<{ study: FishQualityStudy; warning?: string }> {
  const key = keyOf(owner), pending = pendingReads.get(key);
  if (pending) return pending;
  const task = loadQualityStudyRaw(owner).then(loaded => ({ ...loaded, study: applyQualitySourceRatings(applySavedQualityPlans(stopQualityRepair(loaded.study, Date.now()),readSavedQualityPlans(owner))) }));
  pendingReads.set(key, task);
  void task.then(loaded => { void backfillQualityArchiveCounts(owner, loaded.study).finally(() => syncStoredQualityArchiveBodies(owner, loaded.study)); }, () => {});
  const release = () => { if (pendingReads.get(key) === task) pendingReads.delete(key); };
  void task.then(release, release);
  return task;
}
/** Synchronize before a read; the campaign worker opens the durable copy itself. */
export async function prepareQualityCampaignRead(owner?: string): Promise<{ durable: boolean; warning?: string }> {
  const syncStatus = await syncAccountBlobOnLoad(qualityAccountBlob, owner, 180_000);
  // 持仓监测的 Worker 会整条读这份记录：先确保归档正文已经移出去（旧记录可达 478 MB，超过 Worker 内存上限）。
  await ensureQualityArchivesDetached(owner);
  const warning = syncStatus === 'timed_out' ? '账号研究恢复超时，原数据仍保留，请重试。'
    : syncStatus === 'failed' ? '账号研究恢复失败，原数据仍保留，请重试。' : undefined;
  await writes.get(keyOf(owner));
  // Legacy fallback may be newer than IndexedDB; retain its existing merge path.
  let legacy = false;
  try { legacy = localStorage.getItem(keyOf(owner)) != null; } catch { /* durable storage can still work */ }
  return { durable: !legacy && typeof indexedDB !== 'undefined', warning };
}
async function loadQualityStudyRaw(owner?: string): Promise<{ study: FishQualityStudy; warning?: string }> {
  await loadDurableQualityPlans(owner);
  // 【用户要求】2026-10-27 鱼质量研究跟账号走：先和云端对一次账（换电脑登录也能看到），再读本机。
  const {warning: recoveryError} = await prepareQualityCampaignRead(owner);
  let fallback: unknown;
  try { fallback = JSON.parse(localStorage.getItem(keyOf(owner)) ?? 'null'); } catch { /* durable copy still works */ }
  try {
    const db = await open();
    try {
      const stored = await new Promise<unknown>((resolve, reject) => {
        const req = db.transaction(STORE).objectStore(STORE).get(keyOf(owner));
        req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
      });
      // A fallback can be newer if a previous durable write failed.
      if (stored != null && !valid(stored)) throw new Error('invalid saved study');
      const study=valid(fallback)?preserveStudy(valid(stored)?stored:undefined,fallback):valid(stored)?applySourceDeletions(stored):newQualityStudy();
      if(recoveryError&&qualityAccountBlob.weight(study)===0)throw new Error(recoveryError);
      return {study,warning:recoveryError};
    } finally { db.close(); }
  } catch {
    if(recoveryError&&(!valid(fallback)||qualityAccountBlob.weight(fallback)===0))throw new Error(recoveryError);
    return { study: valid(fallback) ? fallback : newQualityStudy(), warning: '鱼质量的本机存储暂不可用；当前结果可能无法在刷新后恢复，请保留此页面。' };
  }
}
export function mergeRemoteQualityStudy(local: FishQualityStudy | undefined, remote: FishQualityStudy, preferRemote = false): FishQualityStudy {
  if (!local) return remote;
  const base=preferRemote?remote:local,other=preferRemote?local:remote;
  const byId = <T,>(left: readonly T[], right: readonly T[], key: (v:T)=>string) => [...new Map([...left,...right].map(v=>[key(v),v])).values()];
  const byTime = <T,>(left: readonly T[], right: readonly T[], key:(v:T)=>string, at:(v:T)=>number) => {
    const map=new Map(left.map(v=>[key(v),v]));
    for(const v of right){const old=map.get(key(v));if(!old||at(v)>=at(old))map.set(key(v),v);}
    return [...map.values()];
  };
  const runs=new Map((other.campaignRuns??[]).map(r=>[r.result.key,r]));
  for(const r of base.campaignRuns??[]){const old=runs.get(r.result.key);if(!old||r.result.evaluatedAt>=old.result.evaluatedAt)runs.set(r.result.key,r);}
  return preserveStudy(other,{...other,...base,
    groups:byId(other.groups,base.groups,g=>g.id),samples:byId(other.samples,base.samples,r=>r.id),
    sellPlans:byId(other.sellPlans??[],base.sellPlans??[],g=>g.id),
    planTemplates:mergeQualityPlanTemplates(other.planTemplates,base.planTemplates),
    results:byTime(other.results,base.results,r=>r.key,r=>r.evaluatedAt),campaignRuns:[...runs.values()],
    filterReadings:byTime(other.filterReadings??[],base.filterReadings??[],r=>r.key,r=>r.at??0),
  });
}
// Serialize writes per account. A slow earlier write must never overwrite a later result/rule edit.
const writes = new Map<string, Promise<boolean>>();

/**
 * 一次性迁移：旧记录里内嵌的归档正文移到归档库（见 qualityArchiveStore 的事故说明）。
 * 排在该账号的写队列里；每页每账号查一次，查过且干净就在本机记一笔，以后打开不再为此整条读。
 */
const DETACHED_MARK = (owner?: string) => `veil-fish-quality-archives-detached-v1:${owner ?? 'anonymous'}`;
const detachChecks = new Map<string, Promise<void>>();
export function ensureQualityArchivesDetached(owner?: string, force = false): Promise<void> {
  const key = keyOf(owner), existing = detachChecks.get(key);
  if (existing && !force) return existing;
  if (force) { try { localStorage.removeItem(DETACHED_MARK(owner)); } catch { /* 下面照样迁移 */ } }
  else { try { if (localStorage.getItem(DETACHED_MARK(owner)) === '1') { const done = Promise.resolve(); detachChecks.set(key, done); return done; } } catch { /* 查一次 */ } }
  const read = async (db: IDBDatabase) => new Promise<unknown>((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
  const run = (writes.get(key) ?? Promise.resolve(true)).then(async () => {
    let clean = false;
    try {
      let db = await open(), stored: unknown;
      try { stored = await read(db); } finally { db.close(); }
      if (!valid(stored) || !qualityStudyHasInlineArchives(stored)) clean = true;
      else {
        await detachQualityArchiveBodies(owner, stored);
        stored = undefined; // 先放掉这份几百 MB 的副本，再重读一次（期间别的标签页可能写过）
        db = await open();
        try {
          await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE, 'readwrite'), store = tx.objectStore(STORE), again = store.get(key);
            again.onsuccess = () => { if (valid(again.result)) { const next = stripStoredQualityArchiveBodies(owner, again.result); clean = !qualityStudyHasInlineArchives(next); if (next !== again.result) store.put(next, key); else resolve(); } else { clean = true; resolve(); } };
            tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error);
          });
        } finally { db.close(); }
      }
    } catch { clean = false; }
    if (clean) { try { localStorage.setItem(DETACHED_MARK(owner), '1'); } catch { /* 下次打开再查一次 */ } }
    else detachChecks.delete(key);
    return true;
  });
  writes.set(key, run);
  void run.finally(() => { if (writes.get(key) === run) writes.delete(key); });
  const done = run.then(() => undefined, () => undefined);
  if (!force) detachChecks.set(key, done);
  return done;
}
export function saveQualityStudy(owner: string | undefined, study: FishQualityStudy, options?: { repairOnly?: boolean; remote?: {preferRemote:boolean} }): Promise<boolean> {
  const key = keyOf(owner);
  // App studies use immutable updates. IndexedDB already clones on put; making
  // an eager deep copy for every queued save multiplies the entire archive.
  let copy = compactQualityStudyForStorage(study);
  const merge = (previous: unknown) => applySavedQualityPlans(compactQualityStudyForStorage(stripStoredQualityArchiveBodies(owner, options?.remote ? mergeRemoteQualityStudy(valid(previous)?previous:undefined,copy,options.remote.preferRemote) : options?.repairOnly && valid(previous) ? preserveStudy(copy,previous) : preserveStudy(valid(previous) ? previous : undefined,copy))),readSavedQualityPlans(owner));
  let leftInline = false;
  const task = (writes.get(key) ?? Promise.resolve(true)).then(()=>serializeArchiveWork(async () => {
    copy=await restorePreEntryStudy(copy);
    let durablePrevious: FishQualityStudy | undefined;
    // 新归档的正文先写进归档库，总表只存目录。
    copy = await detachQualityArchiveBodies(owner, copy);
    try {
      const db = await open();
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE, 'readwrite'), store = tx.objectStore(STORE), read = store.get(key);
          read.onsuccess = () => { durablePrevious = valid(read.result) ? read.result : undefined; const next = merge(read.result); leftInline = qualityStudyHasInlineArchives(next); store.put(next, key); };
          tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error);
        });
      } finally { db.close(); }
      try { localStorage.removeItem(key); } catch { /* optional cache cleanup */ }
      return true;
    } catch {
      try {
        const saved = JSON.parse(localStorage.getItem(key) ?? 'null');
        localStorage.setItem(key, JSON.stringify(merge(valid(saved) ? preserveStudy(durablePrevious,saved) : durablePrevious))); return true;
      } catch { return false; }
    }
  }));
  writes.set(key, task);
  // 记录里还剩内嵌正文（旧标签页写回的、或这次没写进归档库的）：排在这次保存之后再迁一次。
  void task.then(() => { if (leftInline) void ensureQualityArchivesDetached(owner, true); });
  void task.then(ok => { if (ok) noteAccountBlobSaved(qualityAccountBlob, owner); });
  void task.then(ok => { if (ok && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('fish-quality-saved', { detail: { owner, repair: copy.campaignRepair && { id: copy.campaignRepair.id, state: copy.campaignRepair.state } } })); });
  void task.finally(() => { if (writes.get(key) === task) writes.delete(key); });
  return task;
}

/**
 * 早先迁移出去的归档目录项没记运行结果数（目录里显示「N 项运行结果」要用）：逐份读一次本机正文补上，
 * 只给缺数的目录项加这一个字段，其余原样。每页每账号一轮；补上的数下次打开生效。
 */
const countBackfills = new Map<string, Promise<void>>();
export function backfillQualityArchiveCounts(owner: string | undefined, study: FishQualityStudy): Promise<void> {
  const key = keyOf(owner), missing = (study.monitorLibrary?.archives ?? []).filter(a => !a.study && !Number.isFinite(a.resultCount)).map(a => a.id);
  if (!missing.length) return Promise.resolve();
  const existing = countBackfills.get(key);
  if (existing) return existing;
  const task = (async () => {
    const counts = new Map<string, number>();
    for (const id of missing) { const n = await readStoredQualityArchiveResultCount(owner, id); if (n != null) counts.set(id, n); }
    if (!counts.size) return;
    const run = (writes.get(key) ?? Promise.resolve(true)).then(async () => {
      const db = await open();
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE, 'readwrite'), store = tx.objectStore(STORE), read = store.get(key);
          read.onsuccess = () => {
            const saved = read.result, library = valid(saved) ? saved.monitorLibrary : undefined;
            if (!library?.archives?.some(a => !a.study && !Number.isFinite(a.resultCount) && counts.has(a.id))) { resolve(); return; }
            store.put({ ...saved, monitorLibrary: { ...library, archives: library.archives.map(a => !a.study && !Number.isFinite(a.resultCount) && counts.has(a.id) ? { ...a, resultCount: counts.get(a.id)! } : a) } }, key);
          };
          tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error);
        });
      } finally { db.close(); }
      return true;
    }).catch(() => true);
    writes.set(key, run);
    void run.finally(() => { if (writes.get(key) === run) writes.delete(key); });
    await run;
  })().catch(() => undefined);
  countBackfills.set(key, task);
  return task;
}

/** 账号云端存档：本机那份原样上传；取回云端时排进同一条写队列，绝不和页面的保存交错。 */
export const qualityAccountBlob: AccountBlobAdapter<FishQualityStudy> = {
  name: 'fish-quality',
  async prepareStored(owner,knownHash){
    await ensureQualityArchivesDetached(owner);await writes.get(keyOf(owner));
    // A legacy emergency localStorage copy may be newer; retain that exact
    // recovery path instead of bypassing it in the durable-only worker.
    let fallback=false;try{fallback=localStorage.getItem(keyOf(owner))!=null;}catch{/* durable copy remains available */}
    if(fallback){const value=await qualityAccountBlob.read(owner);return value?prepareAccountBlob(value,knownHash):undefined;}
    return prepareStoredQuality(owner,readSavedQualityPlans(owner),knownHash);
  },
  async mergeRemote(owner,value,context){if(value&&!await saveQualityStudy(owner,value,{remote:{preferRemote:context?.preferRemote??false}}))throw Error('鱼质量跨设备合并未保存');},
  async read(owner) {
    const key = keyOf(owner);
    await ensureQualityArchivesDetached(owner);
    await writes.get(key);
    let fallback: unknown;
    try { fallback = JSON.parse(localStorage.getItem(key) ?? 'null'); } catch { /* 只看 IndexedDB */ }
    try {
      const db = await open();
      try {
        const stored = await new Promise<unknown>((resolve, reject) => {
          const req = db.transaction(STORE).objectStore(STORE).get(key);
          req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
        });
        // 上传的总表不带归档正文：正文各有各的云端存档（qualityArchiveBodyBlob）。
        if (valid(fallback)) return withoutQualityArchiveBodies(applySavedQualityPlans(preserveStudy(valid(stored) ? stored : undefined, fallback),readSavedQualityPlans(owner)));
        return valid(stored) ? withoutQualityArchiveBodies(applySavedQualityPlans(stored,readSavedQualityPlans(owner))) : undefined;
      } finally { db.close(); }
    } catch { return valid(fallback) ? withoutQualityArchiveBodies(applySavedQualityPlans(fallback,readSavedQualityPlans(owner))) : undefined; }
  },
  write(owner, study) {
    const key = keyOf(owner);
    const task = (writes.get(key) ?? Promise.resolve(true)).then(async () => {
      const incoming = study && valid(study) ? await detachQualityArchiveBodies(owner, await restorePreEntryStudy(study)) : study;
      const db = await open();
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE, 'readwrite'), store = tx.objectStore(STORE);
          if (incoming && valid(incoming)) {
            const read = store.get(key);
            read.onsuccess = () => store.put(compactQualityStudyForStorage(stripStoredQualityArchiveBodies(owner, preserveLibraries(valid(read.result) ? read.result : undefined, incoming))), key);
          } else store.delete(key);
          tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error);
        });
      } finally { db.close(); }
      try { localStorage.removeItem(key); } catch { /* optional cache cleanup */ }
      return true;
    });
    writes.set(key, task);
    void task.finally(() => { if (writes.get(key) === task) writes.delete(key); }).catch(() => {});
    return task.then(() => undefined);
  },
  weight: study => study ? Object.keys(study.deletedSources??{}).length + Object.keys(study.monitorLibrary?.directoryEdits??{}).length + (study.monitorLibrary?.archives?.length??0) + (study.postExitReadings?.length ?? 0) + study.samples.length + study.results.length + (study.campaignRuns?.length ?? 0) + (study.monitorLibrary?.records.length ?? 0) + (study.monitorLibrary?.rounds.length ?? 0) + (study.filterLibrary?.records.length ?? 0) + (study.filterLibrary?.rounds.length ?? 0) : 0,
};
