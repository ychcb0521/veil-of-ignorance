import { noteAccountBlobSaved, syncAccountBlobOnLoad, type AccountBlobAdapter } from '@/lib/accountBlobSync';
import { emptyPreEntryLibrary, type PreEntryLibrary } from './preEntryMonitor';

import { validPreEntryLibrary as valid, readPreEntryTableClears, writePreEntryTableClears, removePublishedPreEntryDrafts } from './preEntryPersistence';
import {readProjectedPreEntry as read,decodeProjectedPreEntry} from './preEntryArchiveClient';
import { validPreEntryTableClears, type PreEntryTableClears } from './preEntryTableClears';
import { persistPreEntrySnapshot } from './preEntryPersistenceClient';
import { prepareStoredPreEntry } from './preEntryBackup';

const queues = new Map<string, Promise<unknown>>();
const immediateQueues = new Map<string, Promise<unknown>>();
const keyOf = (owner?: string) => owner ? `user:${owner}` : 'anonymous';
function write(owner: string | undefined, library: PreEntryLibrary, immediate = false): Promise<void> {
  // Callers use immutable snapshots. postMessage/IndexedDB already clone at
  // the storage boundary; an extra JS clone doubled every checkpoint's heap.
  const key = keyOf(owner);
  const lane = immediate ? immediateQueues : queues;
  const task = () => persistPreEntrySnapshot(owner, library, immediate);
  const pending = (lane.get(key) ?? Promise.resolve()).then(task, task);
  const settled = pending.catch(() => undefined);
  lane.set(key, settled);
  void settled.then(() => { if (lane.get(key) === settled) lane.delete(key); });
  return pending;
}
export const preEntryV6AccountBlob: AccountBlobAdapter<PreEntryLibrary> = {
  name: 'pre-entry-monitor-v6',
  decodeRemote:decodeProjectedPreEntry,
  async read(owner) { await Promise.all([queues.get(keyOf(owner)), immediateQueues.get(keyOf(owner))]); return read(owner); },
  async prepareStored(owner, knownHash) { await Promise.all([queues.get(keyOf(owner)), immediateQueues.get(keyOf(owner))]); return prepareStoredPreEntry(owner, knownHash); },
  async write(owner, value) { if (value) { if (!valid(value)) throw Error('入选库云端存档格式无效'); await write(owner, value); } },
  async mergeRemote(owner, value) { if (value) await preEntryV6AccountBlob.write(owner, value); },
  weight: library => library ? library.records.length + library.rounds.length + (library.settings ? 1 : 0) : 0,
};
/** Independent small backup; a display-only erase must not re-encode the full audit. */
export const preEntryTableClearsAccountBlob: AccountBlobAdapter<PreEntryTableClears> = {
  name: 'pre-entry-table-clears-v1',
  read: readPreEntryTableClears,
  async write(owner, value) {
    if (value === undefined) return;
    if (!validPreEntryTableClears(value)) throw Error('筛选清除标记格式无效');
    await writePreEntryTableClears(owner, value);
  },
  async mergeRemote(owner, value) { await preEntryTableClearsAccountBlob.write(owner, value); },
  weight: value => Object.keys(value ?? {}).length,
};
export async function savePreEntryTableClears(owner: string | undefined, marks: PreEntryTableClears): Promise<void> {
  await writePreEntryTableClears(owner, marks);
  void noteAccountBlobSaved(preEntryTableClearsAccountBlob, owner);
}
export async function loadPreEntryLibraryV6(owner?: string,preview?:(library:PreEntryLibrary)=>void,rebuild=false): Promise<PreEntryLibrary> {
  const [status, clearsStatus] = await Promise.all([syncAccountBlobOnLoad(preEntryV6AccountBlob, owner,300_000), syncAccountBlobOnLoad(preEntryTableClearsAccountBlob, owner,30_000)]);
  if (clearsStatus === 'failed' || clearsStatus === 'timed_out') throw Error('无法恢复筛选清除标记，请重试');
  await Promise.all([queues.get(keyOf(owner)), immediateQueues.get(keyOf(owner))]);
  const local = await read(owner,preview,rebuild);
  if (!local && (status === 'failed' || status === 'timed_out')) throw Error('无法读取账号入选库，请重试');
  return local ?? emptyPreEntryLibrary();
}
export async function savePreEntryLibraryV6(owner: string | undefined, library: PreEntryLibrary, immediate = false): Promise<void> {
  await write(owner, library, immediate);
  void noteAccountBlobSaved(preEntryV6AccountBlob, owner);
}

// Manual drafts use a separate local namespace; old pages and cloud library exports only see committed runs.
const workspaceDraftOwner = (owner?: string) => `quality-workspace-draft:${owner ?? 'anonymous'}`;
export async function loadPreEntryWorkspaceDraft(owner?: string): Promise<PreEntryLibrary> {
  const draftOwner = workspaceDraftOwner(owner);
  await queues.get(keyOf(draftOwner));
  return await read(draftOwner) ?? emptyPreEntryLibrary();
}
export const savePreEntryWorkspaceDraft = (owner: string | undefined, delta: PreEntryLibrary) => write(workspaceDraftOwner(owner),delta);

export async function discardPublishedWorkspaceDraft(owner:string|undefined,rounds:ReadonlySet<string>,records:readonly string[]):Promise<void> {
  const draftOwner = workspaceDraftOwner(owner);
  await queues.get(keyOf(draftOwner));
  await removePublishedPreEntryDrafts(draftOwner,rounds,records);
}
