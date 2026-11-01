/**
 * 持仓监测「完整归档」的正文单独存放。
 *
 * 【事故】2026-11-01 Chrome 反复「喔唷，崩溃啦！错误代码 5」（V8 内存耗尽）：每次「从头重算」都把整张总表
 * （约 40 MB）复制进同一条鱼质量记录，10 份归档让这条记录到了 478 MB。战役页读持仓监测的 Worker（上限约 470 MB）、
 * 每 15 秒的保存、云端同步编码一碰它就内存耗尽，整个标签页随之崩溃。
 *
 * 现在：总表里只留归档目录（id、时间、原因、来源轮次），正文每份一条记录放在 veil-fish-quality-archives-v1，
 * 打开那份归档时才读。云端每份归档一份独立存档（写一次不再改），换电脑时打开哪份取哪份。
 * 写不进归档库的正文继续内嵌在总表里——宁可大，不可丢。
 */
import type { FishQualityStudy } from './quality';
import type { QualityMonitorArchive, QualityMonitorArchiveStudy } from './qualityMonitorLibrary';
import { applyArchiveSourceDeletions } from './libraryDeletion';
import { noteAccountBlobSaved, syncAccountBlobFully, syncAccountBlobOnLoad, type AccountBlobAdapter } from '@/lib/accountBlobSync';

const DATABASE = 'veil-fish-quality-archives-v1', STORE = 'bodies';
const ownerKey = (owner?: string | null) => owner ?? 'anonymous';
const bodyKey = (owner: string | null | undefined, id: string) => `${ownerKey(owner)}\u0000${id}`;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
    const request = indexedDB.open(DATABASE, 1);
    let expired = false;
    const timer = setTimeout(() => { expired = true; reject(new Error('监测归档存储超时')); }, 8_000);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => { clearTimeout(timer); if (expired) request.result.close(); else resolve(request.result); };
    request.onerror = request.onblocked = () => { clearTimeout(timer); reject(new Error('监测归档存储不可用')); };
  });
}
const validBody = (value: unknown): value is QualityMonitorArchiveStudy => {
  const v = value as QualityMonitorArchiveStudy | null;
  return !!v && typeof v === 'object' && v.version === 1 && Array.isArray(v.samples) && Array.isArray(v.groups) && Array.isArray(v.results);
};
async function getBody(owner: string | null | undefined, id: string): Promise<QualityMonitorArchiveStudy | undefined> {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).get(bodyKey(owner, id));
      req.onsuccess = () => resolve(validBody(req.result) ? req.result : undefined); req.onerror = () => reject(req.error);
    });
  } finally { db.close(); }
}
/** 只问有没有，不把 40 MB 的正文读进内存。 */
async function hasBody(owner: string | null | undefined, id: string): Promise<boolean> {
  const db = await open();
  try {
    const store = db.transaction(STORE).objectStore(STORE);
    if (typeof store.count !== 'function') return !!(await getBody(owner, id));
    return await new Promise((resolve, reject) => {
      const req = store.count(bodyKey(owner, id));
      req.onsuccess = () => resolve(req.result > 0); req.onerror = () => reject(req.error);
    });
  } finally { db.close(); }
}
async function putBody(owner: string | null | undefined, id: string, body: QualityMonitorArchiveStudy | undefined): Promise<void> {
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite'), store = tx.objectStore(STORE);
      if (body) store.put(body, bodyKey(owner, id)); else store.delete(bodyKey(owner, id));
      tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}

/** 本页确认过已存进归档库的正文（按账号）。 */
const stored = new Map<string, Set<string>>();
const storedIds = (owner: string | null | undefined) => {
  let ids = stored.get(ownerKey(owner));
  if (!ids) stored.set(ownerKey(owner), ids = new Set());
  return ids;
};

/** 每份归档一份云端存档；归档不可变，上传一次即可。 */
const blobs = new Map<string, AccountBlobAdapter<QualityMonitorArchiveStudy>>();
export function qualityArchiveBodyBlob(id: string): AccountBlobAdapter<QualityMonitorArchiveStudy> {
  let blob = blobs.get(id);
  if (!blob) blobs.set(id, blob = {
    name: `fish-quality-archive/${id}`,
    read: owner => getBody(owner, id),
    async write(owner, value) { await putBody(owner, id, value); if (value) storedIds(owner).add(id); else storedIds(owner).delete(id); },
    weight: value => value ? 1 : 0,
  });
  return blob;
}

const hasInlineBody = (study: FishQualityStudy | undefined) => !!study?.monitorLibrary?.archives?.some(a => a.study);
export const qualityStudyHasInlineArchives = hasInlineBody;
const directoryEntry = ({ study: _body, ...entry }: QualityMonitorArchive): QualityMonitorArchive => entry;

/** 已确认存进归档库的正文从总表里拿掉，只留目录；其余原样。 */
export function stripStoredQualityArchiveBodies(owner: string | null | undefined, study: FishQualityStudy): FishQualityStudy {
  const library = study.monitorLibrary, ids = stored.get(ownerKey(owner));
  if (!ids || !library?.archives?.some(a => a.study && ids.has(a.id))) return study;
  return { ...study, monitorLibrary: { ...library, archives: library.archives.map(a => a.study && ids.has(a.id) ? directoryEntry(a) : a) } };
}
/** 上传给云端的总表不带任何归档正文（正文各有各的云端存档）。 */
export function withoutQualityArchiveBodies(study: FishQualityStudy): FishQualityStudy {
  const library = study.monitorLibrary;
  if (!hasInlineBody(study)) return study;
  return { ...study, monitorLibrary: { ...library!, archives: library!.archives!.map(directoryEntry) } };
}

/**
 * 把总表里还内嵌着的归档正文写进归档库，返回只留目录的总表。
 * 已经在库里的不重写（归档不可变）；写失败的那份继续内嵌，下次保存再试。
 */
export async function detachQualityArchiveBodies(owner: string | null | undefined, study: FishQualityStudy): Promise<FishQualityStudy> {
  if (!hasInlineBody(study)) return study;
  const ids = storedIds(owner);
  for (const archive of study.monitorLibrary!.archives!) {
    if (!archive.study || ids.has(archive.id)) continue;
    try {
      if (!(await hasBody(owner, archive.id))) {
        await putBody(owner, archive.id, archive.study);
        if (owner) noteAccountBlobSaved(qualityArchiveBodyBlob(archive.id), owner);
      }
      ids.add(archive.id);
    } catch { /* 这份继续内嵌在总表里，数据不丢 */ }
  }
  return stripStoredQualityArchiveBodies(owner, study);
}

/** 打开某份归档：先看总表里有没有内嵌，再读本机归档库，本机没有就从账号云端取回。按当前删除标记过滤后返回。 */
export async function loadQualityMonitorArchive(owner: string | null | undefined, archive: QualityMonitorArchive, current: Pick<FishQualityStudy, 'resolvedLegacySources' | 'deletedSources' | 'deletedReadings'>): Promise<QualityMonitorArchiveStudy> {
  let body = archive.study;
  if (!body) { try { body = await getBody(owner, archive.id); } catch { /* 再试云端 */ } }
  if (!body && owner) {
    const status = await syncAccountBlobOnLoad(qualityArchiveBodyBlob(archive.id), owner, 180_000);
    body = await getBody(owner, archive.id);
    if (!body) throw new Error(status === 'timed_out' ? '从账号取回这份归档超时，请重试' : '这份归档的正文不在本机，账号云端也没有找到');
  }
  if (!body) throw new Error('这份归档的正文不在本机');
  storedIds(owner).add(archive.id);
  return applyArchiveSourceDeletions(body, current);
}

/**
 * 本机已有正文的归档逐份和账号对一次账（没上传过的补传）。一份一份来：每份编码要单独占几十 MB，
 * 多份同时编码正是要避免的内存峰值。每页每账号只跑一轮。
 */
const uploads = new Map<string, Promise<void>>();
export function syncStoredQualityArchiveBodies(owner: string | null | undefined, study: FishQualityStudy): Promise<void> {
  if (!owner) return Promise.resolve();
  const ids = (study.monitorLibrary?.archives ?? []).map(a => a.id);
  if (!ids.length || uploads.has(owner)) return uploads.get(owner) ?? Promise.resolve();
  const task = (async () => {
    for (const id of ids) {
      try { if (await hasBody(owner, id)) { storedIds(owner).add(id); await syncAccountBlobFully(qualityArchiveBodyBlob(id), owner); } }
      catch { /* 下次打开再补 */ }
    }
  })();
  uploads.set(owner, task);
  return task;
}

export function __resetQualityArchiveStoreForTests(): void { stored.clear(); blobs.clear(); uploads.clear(); }
