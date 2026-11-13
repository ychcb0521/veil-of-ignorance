import { noteAccountBlobSaved, syncAccountBlobOnLoad, type AccountBlobAdapter } from '@/lib/accountBlobSync';
import { campaignSectionLabel, isInstantCampaignId, isPaperCampaignId, isQualityCampaignId, qualityCampaignTrashKey } from '@/lib/campaignSections';

type CampaignTrashState = 'active' | 'deleted' | 'purged';
interface CampaignTrashMark {
  state: CampaignTrashState;
  at: number;
}
type PaperSection = 'quality' | 'instant';
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

function validateMarks(value: unknown, section: PaperSection): asserts value is QualityCampaignTrash {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || !Object.entries(value).every(([id, mark]) => (section === 'instant' ? isInstantCampaignId(id) : isQualityCampaignId(id))
        && mark && ['active', 'deleted', 'purged'].includes(mark.state)
        && Number.isSafeInteger(mark.at) && mark.at > 0)) {
    throw new Error(campaignSectionLabel(section) + '回收站记录格式异常');
  }
}

async function transactTrash(
  owner: string,
  section: PaperSection,
  update?: (current: QualityCampaignTrash) => QualityCampaignTrash,
): Promise<QualityCampaignTrash | undefined> {
  if (typeof indexedDB === 'undefined' && !update) return undefined;
  const db = await openTrash();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, update ? 'readwrite' : 'readonly');
      const store = transaction.objectStore(STORE);
      const key = section === 'instant' ? 'instant:' + owner : owner;
      const request = store.get(key);
      let result: QualityCampaignTrash | undefined;
      let failure: unknown;
      request.onsuccess = () => {
        try {
          const current: unknown = request.result;
          if (current !== undefined) validateMarks(current, section);
          result = current as QualityCampaignTrash | undefined;
          if (update) {
            const before = result ?? {};
            result = update(before);
            if (result !== before) store.put(result, key);
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

function trashBlob(section: PaperSection, name: string): AccountBlobAdapter<QualityCampaignTrash> {
  const adapter: AccountBlobAdapter<QualityCampaignTrash> = {
    name,
    read: owner => transactTrash(owner, section),
    async write(owner, remote) {
      if (remote === undefined) return;
      validateMarks(remote, section);
      await transactTrash(owner, section, local => mergeQualityCampaignTrash(local, remote));
      notifyTrash(owner);
    },
    async mergeRemote(owner, remote) { await adapter.write(owner, remote); },
    weight: value => Object.keys(value ?? {}).length,
  };
  return adapter;
}
export const qualityCampaignTrashAccountBlob = trashBlob('quality', 'quality-campaign-trash-v1');
const instantCampaignTrashAccountBlob = trashBlob('instant', 'instant-campaign-trash-v1');
const trashAdapter = (section: PaperSection) => section === 'instant' ? instantCampaignTrashAccountBlob : qualityCampaignTrashAccountBlob;

export async function readQualityCampaignTrash(owner: string, section: PaperSection = 'quality'): Promise<QualityCampaignTrash> {
  return await transactTrash(owner, section) ?? {};
}

export async function loadQualityCampaignTrash(owner: string, section: PaperSection = 'quality'): Promise<QualityCampaignTrash> {
  if (typeof indexedDB !== 'undefined') await syncAccountBlobOnLoad(trashAdapter(section), owner);
  return readQualityCampaignTrash(owner, section);
}

/** Store only the disposition of the derived campaign. The monitoring source remains in its library. */
export async function updateQualityCampaignTrash(owner: string, id: string, state: CampaignTrashState): Promise<void> {
  if (!owner || !isPaperCampaignId(id)) throw new Error('战役无效');
  const section = isInstantCampaignId(id) ? 'instant' : 'quality';
  const label = campaignSectionLabel(section);
  if (typeof indexedDB === 'undefined') throw new Error(label + '回收站存储不可用，请重试');
  const key = qualityCampaignTrashKey(id);
  await transactTrash(owner, section, current => {
    const previous = current[key];
    if (previous?.state === state) return current;
    if (previous?.state === 'purged') throw new Error('这场' + label + '战役已永久移除');
    if (state !== 'deleted' && previous?.state !== 'deleted') {
      if (state === 'active') return current;
      throw new Error('请先将这场战役移入' + label + '回收站');
    }
    return { ...current, [key]: { state, at: Math.max(Date.now(), (previous?.at ?? 0) + 1) } };
  });
  notifyTrash(owner);
  void noteAccountBlobSaved(trashAdapter(section), owner).catch(() => undefined);
}
