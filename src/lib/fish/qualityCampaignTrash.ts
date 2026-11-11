import { noteAccountBlobSaved, syncAccountBlobOnLoad, type AccountBlobAdapter } from '@/lib/accountBlobSync';
import { isQualityCampaignId, qualityCampaignTrashKey } from '@/lib/campaignSections';

type CampaignTrashState = 'active' | 'deleted' | 'purged';
interface CampaignTrashMark {
  state: CampaignTrashState;
  at: number;
}
export type QualityCampaignTrash = Record<string, CampaignTrashMark>;

const DATABASE = 'veil-quality-campaign-trash-v1';
const STORE = 'accounts';
const CHANGE_EVENT = 'veil-quality-campaign-trash-changed';

function openTrash(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('持仓监测回收站存储不可用，请重试'));
    request.onblocked = () => {
      request.onsuccess = () => request.result.close();
      reject(new Error('持仓监测回收站暂时无法打开，请重试'));
    };
  });
}

function validateMarks(value: unknown): asserts value is QualityCampaignTrash {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || !Object.entries(value).every(([id, mark]) => isQualityCampaignId(id)
        && mark && ['active', 'deleted', 'purged'].includes(mark.state)
        && Number.isSafeInteger(mark.at) && mark.at > 0)) {
    throw new Error('持仓监测回收站记录格式异常');
  }
}

async function transactTrash(
  owner: string,
  update?: (current: QualityCampaignTrash) => QualityCampaignTrash,
): Promise<QualityCampaignTrash | undefined> {
  if (typeof indexedDB === 'undefined' && !update) return undefined;
  const db = await openTrash();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, update ? 'readwrite' : 'readonly');
      const store = transaction.objectStore(STORE);
      const request = store.get(owner);
      let result: QualityCampaignTrash | undefined;
      let failure: unknown;
      request.onsuccess = () => {
        try {
          const current: unknown = request.result;
          if (current !== undefined) validateMarks(current);
          result = current as QualityCampaignTrash | undefined;
          if (update) {
            const before = result ?? {};
            result = update(before);
            if (result !== before) store.put(result, owner);
          }
        } catch (error) {
          failure = error;
          transaction.abort();
        }
      };
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(failure ?? new Error('持仓监测回收站操作失败，请重试'));
    });
  } finally {
    db.close();
  }
}

const stateOrder: Record<CampaignTrashState, number> = { active: 0, deleted: 1, purged: 2 };
export function mergeQualityCampaignTrash(local: QualityCampaignTrash, remote: QualityCampaignTrash): QualityCampaignTrash {
  let merged = local;
  for (const [id, next] of Object.entries(remote)) {
    const previous = local[id];
    if (previous?.state === 'purged') continue;
    if (!previous || next.state === 'purged' || next.at > previous.at
        || (next.at === previous.at && stateOrder[next.state] > stateOrder[previous.state])) {
      if (merged === local) merged = { ...local };
      merged[id] = next;
    }
  }
  return merged;
}

function notifyTrash(owner: string) {
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: owner }));
  try {
    const channel = new BroadcastChannel(CHANGE_EVENT);
    channel.postMessage(owner);
    channel.close();
  } catch { /* The transaction is already committed. */ }
}

export function subscribeQualityCampaignTrash(owner: string, refresh: () => void) {
  const listener = (event: Event) => {
    if ((event as CustomEvent<string>).detail === owner) refresh();
  };
  window.addEventListener(CHANGE_EVENT, listener);
  let channel: BroadcastChannel | undefined;
  try {
    channel = new BroadcastChannel(CHANGE_EVENT);
    channel.onmessage = event => { if (event.data === owner) refresh(); };
  } catch { /* Reopening the page also reads the committed state. */ }
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    channel?.close();
  };
}

export const qualityCampaignTrashAccountBlob: AccountBlobAdapter<QualityCampaignTrash> = {
  name: 'quality-campaign-trash-v1',
  read: owner => transactTrash(owner),
  async write(owner, remote) {
    if (remote === undefined) return;
    validateMarks(remote);
    await transactTrash(owner, local => mergeQualityCampaignTrash(local, remote));
    notifyTrash(owner);
  },
  async mergeRemote(owner, remote) { await qualityCampaignTrashAccountBlob.write(owner, remote); },
  weight: value => Object.keys(value ?? {}).length,
};

export async function readQualityCampaignTrash(owner: string): Promise<QualityCampaignTrash> {
  return await transactTrash(owner) ?? {};
}

export async function loadQualityCampaignTrash(owner: string): Promise<QualityCampaignTrash> {
  if (typeof indexedDB !== 'undefined') await syncAccountBlobOnLoad(qualityCampaignTrashAccountBlob, owner);
  return readQualityCampaignTrash(owner);
}

/** Store only the disposition of the derived campaign. The monitoring source remains in its library. */
export async function updateQualityCampaignTrash(owner: string, id: string, state: CampaignTrashState): Promise<void> {
  if (!owner || !isQualityCampaignId(id)) throw new Error('持仓监测战役无效');
  if (typeof indexedDB === 'undefined') throw new Error('持仓监测回收站存储不可用，请重试');
  const key = qualityCampaignTrashKey(id);
  await transactTrash(owner, current => {
    const previous = current[key];
    if (previous?.state === state) return current;
    if (previous?.state === 'purged') throw new Error('这场持仓监测战役已永久移除');
    if (state !== 'deleted' && previous?.state !== 'deleted') {
      if (state === 'active') return current;
      throw new Error('请先将这场战役移入持仓监测回收站');
    }
    return { ...current, [key]: { state, at: Math.max(Date.now(), (previous?.at ?? 0) + 1) } };
  });
  notifyTrash(owner);
  void noteAccountBlobSaved(qualityCampaignTrashAccountBlob, owner).catch(() => undefined);
}
