import { noteAccountBlobSaved, syncAccountBlobOnLoad, type AccountBlobAdapter } from '@/lib/accountBlobSync';
import { emptyPreEntryLibrary, type PreEntryLibrary } from './preEntryMonitor';

import { readPreEntrySnapshot as read, validPreEntryLibrary as valid } from './preEntryPersistence';
import { persistPreEntrySnapshot } from './preEntryPersistenceClient';

const queues = new Map<string, Promise<unknown>>();
const keyOf = (owner?: string) => owner ? `user:${owner}` : 'anonymous';
function write(owner: string | undefined, library: PreEntryLibrary): Promise<void> {
  // The live runner supplies changed records only. Freeze this small delta at
  // submission, then merge it with the full library off the rendering thread.
  const key = keyOf(owner), copy = structuredClone(library);
  const task = () => persistPreEntrySnapshot(owner, copy);
  const pending = (queues.get(key) ?? Promise.resolve()).then(task, task);
  const settled = pending.catch(() => undefined);
  queues.set(key, settled);
  void settled.then(() => { if (queues.get(key) === settled) queues.delete(key); });
  return pending;
}
export const preEntryV6AccountBlob: AccountBlobAdapter<PreEntryLibrary> = {
  name: 'pre-entry-monitor-v6',
  async read(owner) { await queues.get(keyOf(owner)); return read(owner); },
  async write(owner, value) { if (value) { if (!valid(value)) throw Error('入选库云端存档格式无效'); await write(owner, value); } },
  async mergeRemote(owner, value) { if (value) await preEntryV6AccountBlob.write(owner, value); },
  weight: library => library ? library.records.length + library.rounds.length + (library.settings ? 1 : 0) : 0,
};
export async function loadPreEntryLibraryV6(owner?: string): Promise<PreEntryLibrary> {
  const status = await syncAccountBlobOnLoad(preEntryV6AccountBlob, owner);
  await queues.get(keyOf(owner));
  const local = await read(owner);
  if (!local && (status === 'failed' || status === 'timed_out')) throw Error('无法读取账号入选库，请重试');
  return local ?? emptyPreEntryLibrary();
}
export async function savePreEntryLibraryV6(owner: string | undefined, library: PreEntryLibrary): Promise<void> {
  await write(owner, library);
  void noteAccountBlobSaved(preEntryV6AccountBlob, owner);
}
