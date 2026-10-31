/**
 * 大块本机数据（IndexedDB）的账号云端存档。
 *
 * 【用户要求】2026-10-27「把鱼库、鱼质量研究、扫描结果固定到账号里，以后无论在哪台电脑登录都能看到」。
 * 这些数据动辄几 MB，只能放 IndexedDB；通用同步层（simStateSync）登录时会把每一行写回 localStorage
 * （整站共用约 5 MB，写满会登不进），所以单独走这一层：
 *
 *   云端：仍是 user_sim_state 表，键以 `idb:` 开头（登录水化时整批跳过，不下载、不进 localStorage）。
 *         头行  `idb:<name>`    = { v, rev, parts, savedAt, enc, bytes, deleted? }
 *         分片  `idb:<name>#<i>` = { rev, data }       （gzip 后 base64，每片约 0.9 MB）
 *         先写分片、后写头行；读到的分片 rev 和头行对不上（另一台设备写到一半）就当这次读不到，下次再来。
 *   本机：每份数据记 savedAt（最后一次本机保存）、syncedAt（与云端一致的那一版）、rev（那一版的云端编号）。
 *
 * 打开时的取舍：
 *   云端没有                     → 本机有内容就上传；
 *   云端仍是上次同步的那一版     → 本机改过就上传；
 *   云端被别的设备改过           → 本机没改过就取云端；两边都改过，取更晚保存的那份；
 *   本机从没同步过（上线前的旧数据，或在新设备上先打开过空白页） → 本机是空的就取云端，否则取内容更多的那份。
 * 被云端替换掉的本机版本另存一份在本机（replaced），不会无声丢失。
 * 空白的本机数据永远不会盖掉云端已有内容（除非它是同步过之后用户自己清空的）。
 */
import { supabase } from '@/integrations/supabase/client';
import { serializeAccountBlob, deserializeAccountBlob } from './accountBlobCodec';
export { serializeAccountBlob, deserializeAccountBlob } from './accountBlobCodec';

export const ACCOUNT_BLOB_PREFIX = 'idb:';
const CHUNK_CHARS = 900_000;
const PUSH_DELAY_MS = 8_000;
const LOAD_TIMEOUT_MS = 6_000;

export interface AccountBlobAdapter<T = unknown> {
  /** 云端键名（不含前缀），如 fish-quality。 */
  name: string;
  /** 读本机当前那份；没有返回 undefined。 */
  read(owner: string): Promise<T | undefined>;
  /** 用云端那份覆盖本机；undefined = 清空本机。须排进该存储自己的写队列。 */
  write(owner: string, value: T | undefined): Promise<void>;
  /** Libraries opt into merging remote history/deletion marks while retaining local settings. */
  mergeRemote?(owner:string,value:T|undefined,context?:{preferRemote:boolean}):Promise<void>;
  /** 内容多少：0 = 空白。只在两边都没有同步记录时用来比较。 */
  weight(value: T | undefined): number;
}

interface Head { v: 1; rev: string; parts: number; savedAt: number; enc: 'gzip' | 'json'; bytes: number; deleted?: boolean }
/** hash = 与云端一致的那一版内容的指纹：内容没变的保存（关页、切走时的补存）不再重传几 MB。 */
interface Meta { savedAt: number; syncedAt: number; rev?: string; parts?: number; hash?: string }
export type AccountBlobSyncStatus = 'adopted' | 'pushed' | 'unchanged' | 'skipped' | 'failed' | 'timed_out';

const headKey = (name: string) => `${ACCOUNT_BLOB_PREFIX}${name}`;
const chunkKey = (name: string, index: number) => `${ACCOUNT_BLOB_PREFIX}${name}#${index}`;
const idOf = (name: string, owner: string) => `${name}\u0000${owner}`;

// ───────────── 本机记录（同步元数据 + 被替换的旧版本），放 IndexedDB，读写失败退回内存 ─────────────
const memory = new Map<string, unknown>();
let metaDb: Promise<IDBDatabase> | undefined;
function openMetaDb(): Promise<IDBDatabase> {
  return metaDb ??= new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
    const request = indexedDB.open('veil-account-sync-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('records');
    request.onsuccess = () => resolve(request.result);
    request.onerror = request.onblocked = () => reject(request.error ?? new Error('blocked'));
  }).catch(error => { metaDb = undefined; throw error; });
}
/** 本机记录读写最多等 3 秒：卡住的存储不能拖住页面加载。 */
const RECORD_TIMEOUT_MS = 3_000;
function bounded<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('本机同步记录超时')), RECORD_TIMEOUT_MS);
    task().then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}
async function getRecord<T>(key: string): Promise<T | undefined> {
  try {
    return await bounded(async () => {
      const db = await openMetaDb();
      return new Promise<T | undefined>((resolve, reject) => {
        const request = db.transaction('records').objectStore('records').get(key);
        request.onsuccess = () => resolve(request.result as T | undefined);
        request.onerror = () => reject(request.error);
      });
    });
  } catch { return memory.get(key) as T | undefined; }
}
async function putRecord(key: string, value: unknown): Promise<void> {
  memory.set(key, value);
  try {
    await bounded(async () => {
      const db = await openMetaDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('records', 'readwrite');
        tx.objectStore('records').put(value, key);
        tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error);
      });
    });
  } catch { /* 内存里那份仍可用到本页结束；下次打开按「从没同步过」处理，空白数据不会盖掉云端 */ }
}
const readMeta = (name: string, owner: string) => getRecord<Meta>(`meta:${idOf(name, owner)}`);
const writeMeta = (name: string, owner: string, meta: Meta) => putRecord(`meta:${idOf(name, owner)}`, meta);

/** 被云端替换前的本机版本（每份只留最近一次），供排查和人工找回。 */
export const readReplacedAccountBlob = (name: string, owner: string) =>
  getRecord<{ replacedAt: number; value: unknown }>(`replaced:${idOf(name, owner)}`);

// ───────────── 编码：保住 JSON 表达不了的值（Map / Set / Date / NaN / ±Infinity） ─────────────

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
function fromBase64(text: string): Uint8Array {
  const binary = atob(text), bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  void writer.write(bytes as unknown as BufferSource).catch(() => {}); void writer.close().catch(() => {});
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}
/** 内容指纹（FNV-1a，两轮不同种子拼成 64 位），只用来判断「和上次传的是不是同一份」。 */
export function fingerprintAccountBlob(json: string): string {
  let a = 0x811c9dc5, b = 0x01000193 ^ json.length;
  for (let i = 0; i < json.length; i += 1) {
    const c = json.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995);
  }
  return `${(a >>> 0).toString(36)}.${(b >>> 0).toString(36)}.${json.length}`;
}
export async function encodeAccountBlob(value: unknown, serialized?: string): Promise<{ enc: Head['enc']; text: string; bytes: number }> {
  const json = serialized ?? serializeAccountBlob(value);
  if (typeof CompressionStream === 'function') {
    try {
      const packed = await pipe(new TextEncoder().encode(json), new CompressionStream('gzip'));
      return { enc: 'gzip', text: toBase64(packed), bytes: json.length };
    } catch { /* 压缩不可用时原样存 */ }
  }
  return { enc: 'json', text: json, bytes: json.length };
}
export async function decodeAccountBlob(enc: Head['enc'], text: string): Promise<unknown> {
  if (typeof Worker === 'function' && text.length > 1_000_000) {
    return new Promise((resolve,reject) => {
      const worker = new Worker(new URL('./workers/accountBlobDecoder.worker.ts', import.meta.url), {type:'module'});
      const finish = () => { clearTimeout(timer); worker.terminate(); };
      const timer = setTimeout(() => { finish(); reject(new Error('账号研究档案解码超时')); },120_000);
      worker.onmessage = event => { finish(); event.data.ok ? resolve(event.data.value) : reject(new Error('账号研究档案解码失败')); };
      worker.onerror = () => { finish(); reject(new Error('账号研究档案解码失败')); };
      worker.postMessage({enc,text});
    });
  }
  if (enc === 'json') return deserializeAccountBlob(text);
  const bytes = await pipe(fromBase64(text), new DecompressionStream('gzip'));
  return deserializeAccountBlob(new TextDecoder().decode(bytes));
}

// ───────────── 云端读写 ─────────────
const table = () => supabase.from('user_sim_state' as never);
function validHead(value: unknown): value is Head {
  const h = value as Head | null;
  return !!h && h.v === 1 && typeof h.rev === 'string' && Number.isInteger(h.parts) && h.parts >= 0
    && Number.isFinite(h.savedAt) && (h.enc === 'gzip' || h.enc === 'json');
}
async function fetchHead(name: string, owner: string): Promise<Head | null> {
  const { data, error } = await (table().select('value') as any).eq('user_id', owner).eq('key', headKey(name)).maybeSingle();
  if (error) throw new Error(error.message);
  const value = (data as { value?: unknown } | null)?.value;
  return validHead(value) ? value : null;
}
async function fetchValue(name: string, owner: string, head: Head): Promise<{ ok: true; value: unknown } | { ok: false }> {
  if (head.deleted) return { ok: true, value: undefined };
  const keys = Array.from({ length: head.parts }, (_, i) => chunkKey(name, i));
  const { data, error } = await (table().select('key, value') as any).eq('user_id', owner).in('key', keys);
  if (error) throw new Error(error.message);
  const byKey = new Map(((data ?? []) as { key: string; value: { rev?: string; data?: string } }[]).map(row => [row.key, row.value]));
  const parts: string[] = [];
  for (const key of keys) {
    const part = byKey.get(key);
    // 另一台设备写到一半：分片和头行不是同一版，这次不取。
    if (!part || part.rev !== head.rev || typeof part.data !== 'string') return { ok: false };
    parts.push(part.data);
  }
  return { ok: true, value: await decodeAccountBlob(head.enc, parts.join('')) };
}
async function upsertRow(owner: string, key: string, value: unknown): Promise<void> {
  const { error } = await (table() as any).upsert({ user_id: owner, key, value, updated_at: new Date().toISOString() }, { onConflict: 'user_id,key' });
  if (error) throw new Error(error.message);
}
async function deleteRows(owner: string, keys: string[]): Promise<void> {
  if (!keys.length) return;
  const { error } = await (table() as any).delete().eq('user_id', owner).in('key', keys);
  if (error) throw new Error(error.message);
}
/** 只替当前登录的账号读写云端；没登录（或换了账号）就只用本机，下次打开再对账。 */
async function signedInAs(owner: string): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.user?.id === owner;
  } catch { return false; }
}
const newRev = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

// ───────────── 每份数据一条串行队列：上传、取云端、记本机保存互不交错 ─────────────
const queues = new Map<string, Promise<unknown>>();
function enqueue<T>(id: string, task: () => Promise<T>): Promise<T> {
  const run = (queues.get(id) ?? Promise.resolve()).then(task, task);
  queues.set(id, run.catch(() => undefined));
  return run;
}
const adapters = new Map<string, AccountBlobAdapter<any>>();
const pushTimers = new Map<string, { timer: ReturnType<typeof setTimeout>; adapter: AccountBlobAdapter<any>; owner: string; settled: boolean }>();
let hooksInstalled = false;
function installFlushHooks(): void {
  if (hooksInstalled || typeof window === 'undefined') return;
  hooksInstalled = true;
  // 尽力而为：关页前没传完也不要紧，本机记着「改过未上传」，下次打开会补传。
  const flush = () => { for (const [id, entry] of [...pushTimers]) { clearTimeout(entry.timer); pushTimers.delete(id); void runPush(entry.adapter, entry.owner, entry.settled); } };
  window.addEventListener('pagehide', flush);
  window.addEventListener('online', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
}
/** settled = 打开时的对账已判定本机这份该上传（从没同步过的本机数据只有对账能放行）。 */
function schedulePush(adapter: AccountBlobAdapter<any>, owner: string, delay = PUSH_DELAY_MS, settled = false): void {
  const id = idOf(adapter.name, owner);
  const existing = pushTimers.get(id);
  if (existing) clearTimeout(existing.timer);
  installFlushHooks();
  const keep = settled || !!existing?.settled;
  pushTimers.set(id, { adapter, owner, settled: keep, timer: setTimeout(() => { pushTimers.delete(id); void runPush(adapter, owner, keep); }, delay) });
}
function runPush(adapter: AccountBlobAdapter<any>, owner: string, settled = false): Promise<boolean> {
  return enqueue(idOf(adapter.name, owner), () => push(adapter, owner, settled)).catch(() => false);
}

async function push(adapter: AccountBlobAdapter<any>, owner: string, settled: boolean): Promise<boolean> {
  if (!(await signedInAs(owner))) return false;
  const meta = await readMeta(adapter.name, owner);
  let value = await adapter.read(owner);
  let savedAt = meta?.savedAt || Date.now();
  const head = await fetchHead(adapter.name, owner);
  if(head&&head.rev!==meta?.rev&&adapter.mergeRemote&&(meta?.rev||settled)){
    const cloud=await fetchValue(adapter.name,owner,head);if(!cloud.ok)return false;
    await adapter.mergeRemote(owner,cloud.value,{preferRemote:head.savedAt>=savedAt});value=await adapter.read(owner);
    savedAt=Math.max(savedAt,head.savedAt+1);
  }
  if (head) {
    // 云端那一版来自别的设备且更晚保存：不盖它，下次打开时按规则取舍。
    if (head.rev !== meta?.rev && head.savedAt > savedAt) return false;
    // 从没同步过的本机数据（旧数据、新设备上的空白页）去留只由打开时的对账决定，后台上传不能直接盖云端。
    if (!meta?.rev && !settled) return false;
  } else if (value === undefined) {
    await writeMeta(adapter.name, owner, { savedAt, syncedAt: savedAt, parts: 0 });
    return true;
  }
  const json = value === undefined ? undefined : serializeAccountBlob(value);
  const hash = json === undefined ? 'deleted' : fingerprintAccountBlob(json);
  if (head && meta?.rev && head.rev === meta.rev && meta.hash === hash) {
    // 云端仍是上次那一版、内容也一样：只记一笔已同步。
    const latest = await readMeta(adapter.name, owner);
    await writeMeta(adapter.name, owner, { ...meta, savedAt: Math.max(latest?.savedAt ?? 0, savedAt), syncedAt: savedAt });
    if ((latest?.savedAt ?? 0) > savedAt) schedulePush(adapter, owner);
    return true;
  }
  const rev = newRev();
  let parts = 0, nextHead: Head;
  if (value === undefined) {
    nextHead = { v: 1, rev, parts: 0, savedAt, enc: 'json', bytes: 0, deleted: true };
  } else {
    const encoded = await encodeAccountBlob(value, json);
    parts = Math.max(1, Math.ceil(encoded.text.length / CHUNK_CHARS));
    for (let i = 0; i < parts; i += 1) {
      await upsertRow(owner, chunkKey(adapter.name, i), { rev, data: encoded.text.slice(i * CHUNK_CHARS, (i + 1) * CHUNK_CHARS) });
    }
    nextHead = { v: 1, rev, parts, savedAt, enc: encoded.enc, bytes: encoded.bytes };
  }
  await upsertRow(owner, headKey(adapter.name), nextHead);
  const previousParts = Math.max(head?.parts ?? 0, meta?.parts ?? 0);
  await deleteRows(owner, Array.from({ length: Math.max(0, previousParts - parts) }, (_, i) => chunkKey(adapter.name, parts + i))).catch(() => {});
  // 上传期间本机又保存过：savedAt 只进不退，那一版仍算「改过未上传」。
  const latest = await readMeta(adapter.name, owner);
  await writeMeta(adapter.name, owner, { savedAt: Math.max(latest?.savedAt ?? 0, savedAt), syncedAt: savedAt, rev, parts, hash });
  if ((latest?.savedAt ?? 0) > savedAt) schedulePush(adapter, owner);
  return true;
}

async function adopt(adapter: AccountBlobAdapter<any>, owner: string, head: Head, value: unknown, local: unknown): Promise<void> {
  if (local !== undefined && adapter.weight(local) > 0) {
    await putRecord(`replaced:${idOf(adapter.name, owner)}`, { replacedAt: Date.now(), value: local });
  }
  await adapter.write(owner, value);
  const hash = value === undefined ? 'deleted' : fingerprintAccountBlob(serializeAccountBlob(value));
  await writeMeta(adapter.name, owner, { savedAt: head.savedAt, syncedAt: head.savedAt, rev: head.rev, parts: head.parts, hash });
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('veil-account-blob-adopted', { detail: { name: adapter.name, owner } }));
}

/**
 * 打开时对一次账：按文件头注释的规则决定取云端、上传本机还是不动。
 * `begin()` 返回 false 表示页面已经等不及、先用本机那份了——此时绝不再改本机数据。
 */
async function reconcile(adapter: AccountBlobAdapter<any>, owner: string, begin: () => boolean): Promise<AccountBlobSyncStatus> {
  if (!(await signedInAs(owner))) return 'skipped';
  const [meta, local, head] = await Promise.all([readMeta(adapter.name, owner), adapter.read(owner), fetchHead(adapter.name, owner)]);
  const localWeight = adapter.weight(local);
  if (!head) {
    if (localWeight > 0 || (meta?.rev && meta.savedAt > meta.syncedAt)) { schedulePush(adapter, owner, 0, true); return 'pushed'; }
    return 'unchanged';
  }
  const dirty = !!meta?.rev && meta.savedAt > meta.syncedAt;
  if (meta?.rev && head.rev === meta.rev) {
    if (dirty) { schedulePush(adapter, owner, 0, true); return 'pushed'; }
    return 'unchanged';
  }
  let takeCloud: boolean;
  let cloud: { ok: true; value: unknown } | { ok: false } | undefined;
  if (meta?.rev) takeCloud = !dirty || head.savedAt >= meta.savedAt;
  else if (localWeight === 0) takeCloud = true;
  else {
    cloud = await fetchValue(adapter.name, owner, head);
    if (!cloud.ok) return 'failed';
    takeCloud = adapter.weight(cloud.value) > localWeight;
  }
  if(adapter.mergeRemote){
    cloud??=await fetchValue(adapter.name,owner,head);
    if(!cloud.ok)return 'failed';
    if(!begin())return 'skipped';
    await adapter.mergeRemote(owner,cloud.value,{preferRemote:takeCloud});
    // The merged copy includes this head. Mark it dirty against that exact revision;
    // the queued push must not download and merge the same large archive again.
    const latest=await readMeta(adapter.name,owner);
    await writeMeta(adapter.name,owner,{rev:head.rev,parts:head.parts,savedAt:Math.max(Date.now(),latest?.savedAt??0,head.savedAt+1),syncedAt:head.savedAt});
    schedulePush(adapter,owner,0,true);
    return 'adopted';
  }
  if (!takeCloud) { schedulePush(adapter, owner, 0, true); return 'pushed'; }
  cloud ??= await fetchValue(adapter.name, owner, head);
  if (!cloud.ok) return 'failed';
  if (!begin()) return 'skipped';
  await adopt(adapter, owner, head, cloud.value, local);
  return 'adopted';
}

const loads = new Map<string, { task: Promise<AccountBlobSyncStatus>; gate: { state: 'open' | 'adopting' | 'closed' } }>();
/**
 * 本机存储读取前调用：每页每个账号对一次账，最多等 6 秒；
 * 超时就先用本机那份（之后的对账不再改本机数据，下次打开再来）。
 */
export function syncAccountBlobOnLoad(adapter: AccountBlobAdapter<any>, owner: string | null | undefined, timeoutMs = LOAD_TIMEOUT_MS): Promise<AccountBlobSyncStatus> {
  if (!owner) return Promise.resolve('skipped');
  adapters.set(adapter.name, adapter);
  const id = idOf(adapter.name, owner);
  let entry = loads.get(id);
  if (!entry) {
    const gate: { state: 'open' | 'adopting' | 'closed' } = { state: 'open' };
    const task = enqueue(id, () => reconcile(adapter, owner, () => { if (gate.state !== 'open') return false; gate.state = 'adopting'; return true; }))
      .catch((): AccountBlobSyncStatus => 'failed');
    const created = { task, gate };
    loads.set(id, created);
    entry = created;
    // 失败或没赶上：下次打开再对账。
    void task.then(status => { if ((status === 'failed' || status === 'skipped') && loads.get(id) === created) loads.delete(id); });
  }
  const { task, gate } = entry;
  // 正在把云端那份写进本机时不能放行（否则页面读到旧的、之后又拿旧的盖回去）；其余情况超时即先用本机。
  const timer = new Promise<AccountBlobSyncStatus>(resolve => setTimeout(() => { if (gate.state !== 'adopting') { gate.state = 'closed'; resolve('timed_out'); } }, timeoutMs));
  return Promise.race([task, timer]);
}

/** 本机存储每次保存成功后调用：记下「改过未上传」，几秒后上传（连续保存只传最后一版）。 */
export function noteAccountBlobSaved(adapter: AccountBlobAdapter<any>, owner: string | null | undefined): void {
  if (!owner) return;
  adapters.set(adapter.name, adapter);
  void enqueue(idOf(adapter.name, owner), async () => {
    if (!(await signedInAs(owner))) return false;
    const meta = await readMeta(adapter.name, owner);
    const savedAt = Math.max(Date.now(), (meta?.savedAt ?? 0) + 1);
    await writeMeta(adapter.name, owner, { ...(meta ?? { syncedAt: 0 }), savedAt });
    return true;
  }).then(signed => { if (signed) schedulePush(adapter, owner); }, () => schedulePush(adapter, owner));
}

/** 测试用：立刻执行所有排队的上传并等它们完成。 */
export async function flushAccountBlobPushesForTests(): Promise<void> {
  for (let round = 0; round < 20; round += 1) {
    await Promise.all([...queues.values()]);
    await new Promise(resolve => setTimeout(resolve, 0));
    await Promise.all([...queues.values()]);
    const entries = [...pushTimers.values()];
    if (!entries.length) return;
    for (const entry of entries) clearTimeout(entry.timer);
    pushTimers.clear();
    await Promise.all(entries.map(entry => runPush(entry.adapter, entry.owner, entry.settled)));
  }
}
/** 测试用：同一台设备新开一页（本机记录保留，页内对账缓存清空）。 */
export function __startNewPageForTests(): void { loads.clear(); }
export function __resetAccountBlobSyncForTests(): void {
  for (const entry of pushTimers.values()) clearTimeout(entry.timer);
  pushTimers.clear(); queues.clear(); loads.clear(); memory.clear(); adapters.clear();
}
