import type { QualityMonitorRecord } from './qualityMonitorLibrary';

export type Block = [number, number, string];
type Folder = FileSystemDirectoryHandle & {
  values(): AsyncIterable<FileSystemFileHandle | FileSystemDirectoryHandle>;
  queryPermission(options: {mode: 'read'}): Promise<PermissionState>;
  requestPermission(options: {mode: 'read'}): Promise<PermissionState>;
};
export type MonitorFolder = Folder;
export interface DiskRound {
  version: 1; owner: string; id: string; at: number; title: string; bodyId: string;
  count: number; data: string; pageSize: number; pages: Block[]; settings: Block;
}
const hex = /^[a-f0-9]{64}$/;
export const validBlock = (v: unknown): v is Block => Array.isArray(v) && v.length === 3 &&
  Number.isSafeInteger(v[0]) && v[0] >= 0 && Number.isSafeInteger(v[1]) && v[1] > 0 && typeof v[2] === 'string' && hex.test(v[2]);

export function validDiskRound(v: DiskRound, owner: string): boolean {
  return v?.version === 1 && v.owner === owner && typeof v.id === 'string' && v.id.startsWith('monitor-')
    && typeof v.title === 'string' && Number.isSafeInteger(v.at) && /^recent-v1-[a-f0-9]{64}$/.test(v.bodyId)
    && /^[a-f0-9]{64}\.vmon$/.test(v.data) && v.pageSize === 32 && Number.isSafeInteger(v.count) && v.count >= 0
    && Array.isArray(v.pages) && v.pages.length === Math.ceil(v.count / v.pageSize) && v.pages.every(validBlock) && validBlock(v.settings);
}

export async function diskRounds(folder: Folder, owner: string) {
  const rounds: DiskRound[] = [];
  for await (const handle of folder.values()) {
    if (handle.kind !== 'file' || !/^[a-f0-9]{64}\.index\.json$/.test(handle.name)) continue;
    const index = JSON.parse(await (await handle.getFile()).text());
    if (index.owner !== owner) continue;
    if (!validDiskRound(index, owner) || rounds.some(r => r.id === index.id)) throw Error('本机监测目录索引有误，请重新核验归档。');
    rounds.push(index);
  }
  return rounds.sort((a,b) => b.at-a.at);
}

export async function readBlock(file: File, [start,size,digest]: Block) {
  if (start + size > file.size) throw Error('本机监测文件不完整。');
  const bytes = await file.slice(start, start + size).arrayBuffer();
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  if (Array.from(hash, b=>b.toString(16).padStart(2,'0')).join('') !== digest) throw Error('本机监测数据校验失败。');
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).json();
}

export async function readDiskPage(file: File, round: DiskRound, page: number): Promise<QualityMonitorRecord[]> {
  const records = await readBlock(file, round.pages[page]);
  if (!Array.isArray(records) || records.length !== Math.min(round.pageSize, round.count - page * round.pageSize)
      || !records.every(r => typeof r?.id === 'string' && r.id.startsWith(round.id + ':') && typeof r.source?.symbol === 'string')) {
    throw Error('本机明细与所选轮次不符。');
  }
  return records;
}

export async function readDiskSettings(file: File, round: DiskRound) {
  const value = await readBlock(file, round.settings);
  return value.settings;
}

/** Only the selected folder handle is persisted, scoped to the signed-in account. */
export async function monitorFolder(owner: string, folder?: Folder): Promise<Folder | undefined> {
  const db = await new Promise<IDBDatabase>((resolve,reject)=>{
    const req = indexedDB.open('veil-local-monitor-folders',1);
    req.onupgradeneeded = () => req.result.createObjectStore('folders');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  try {
    return await new Promise<Folder | undefined>((resolve,reject)=>{
      const tx = db.transaction('folders', folder ? 'readwrite' : 'readonly');
      const store = tx.objectStore('folders');
      const req = folder ? store.put(folder,owner) : store.get(owner);
      tx.oncomplete = () => resolve(folder ?? req.result as Folder | undefined);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
