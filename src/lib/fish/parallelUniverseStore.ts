import type { ParallelAttempt, ParallelSignal } from './parallelUniverse';
import { qualityEntryIdentity } from './quality';
import { renameLibraryDirectoryEdit, type LibraryDirectoryEdits } from './libraryDirectoryEdits';

export interface RegretCandidate {
  id: string;
  symbol: string;
  entryTime: number | null;
  signal?: ParallelSignal;
  legacy?: boolean;
}

const CANDIDATES = 'candidates';
const HISTORY = 'history';
const SETTINGS = 'settings';
const key = (owner: string | undefined) => owner ? 'user:' + owner : 'anonymous';
const tablePrefix = (owner?: string) => ['parallel-table', key(owner)];
export interface ParallelTableResult {
  entryKey: string;
  evaluatedAt: number;
  planLabel: string;
  reason: string;
  markerAt?: number;
  signal?: ParallelSignal;
}

export function loadParallelTableResults(owner?: string) {
  const prefix = tablePrefix(owner);
  return transaction<ParallelTableResult[]>(SETTINGS, 'readonly', (tx, result) => {
    const request = tx.objectStore(SETTINGS).getAll(IDBKeyRange.bound(prefix, [...prefix, []], true, true));
    request.onsuccess = () => result(request.result);
  });
}

export function clearParallelTableResults(owner?: string) {
  const prefix = tablePrefix(owner);
  return transaction<void>(SETTINGS, 'readwrite', tx => {
    tx.objectStore(SETTINGS).delete(IDBKeyRange.bound(prefix, [...prefix, []], true, true));
  });
}

async function transaction<T>(
  stores: string | string[],
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction, result: (value: T) => void) => void,
): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    let blocked = false;
    const request = indexedDB.open('veil-fish-regret-library-v1', 1);
    request.onupgradeneeded = () => {
      for (const store of [CANDIDATES, HISTORY, SETTINGS]) request.result.createObjectStore(store);
    };
    request.onblocked = () => { blocked = true; reject(Error('后悔库正在其他页面升级')); };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => { if (blocked) request.result.close(); else resolve(request.result); };
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      let value: T;
      tx.oncomplete = () => resolve(value);
      tx.onabort = () => reject(tx.error ?? Error('后悔库操作失败'));
      work(tx, next => { value = next; });
    });
  } finally {
    db.close();
  }
}

export interface ParallelSettings {
  plans?: import('./quality').QualityGroup[];
  planId: string;
  additionCount: number;
  observeHours: number;
}

export function loadParallelSettings(owner?: string) {
  return transaction<ParallelSettings | undefined>(SETTINGS, 'readonly', (tx, result) => {
    const request = tx.objectStore(SETTINGS).get(key(owner));
    request.onsuccess = () => result(request.result);
  });
}

export function saveParallelSettings(owner: string | undefined, settings: ParallelSettings) {
  return transaction<void>(SETTINGS, 'readwrite', tx => {
    tx.objectStore(SETTINGS).put(settings, key(owner));
  });
}

export interface RegretRoundIdentity { id: string; startedAt: number; total: number }
export interface RegretRound extends RegretRoundIdentity {
  plan: ParallelAttempt['plan'];
  additionCount: number;
  observeHours: number;
  done: number;
  emitted: number;
}
export type RegretAttempt = ParallelAttempt & { emitted: boolean; roundId?: string };
const roundPrefix = (owner?: string) => ['regret-round', key(owner)];
const roundRowsPrefix = (owner: string | undefined, id: string) => ['regret-round-rows', key(owner), id];
const regretEditsKey = (owner?: string) => ['regret-directory-edits', key(owner)];
const prefixRange = (prefix: IDBValidKey[]) => IDBKeyRange.bound(prefix, [...prefix, []], true, true);

export function saveParallelAttempt(owner: string | undefined, attempt: ParallelAttempt, round?: RegretRoundIdentity) {
  const { candidate, proposedSignal } = attempt;
  const id = candidate.signalId ?? candidate.id;
  const ownerKey = key(owner);
  return transaction<ParallelTableResult | undefined>([CANDIDATES, HISTORY, SETTINGS], 'readwrite', (tx, result) => {
    const store = tx.objectStore(CANDIDATES);
    const history = tx.objectStore(HISTORY);
    const historyKey = [ownerKey, id, attempt.baseline.evaluatedAt, attempt.id];
    const existing = history.getKey(historyKey);
    existing.onsuccess = () => {
      if (existing.result !== undefined) return;
      const request = store.get([ownerKey, id]);
      request.onsuccess = () => {
        const previous: RegretCandidate | undefined = request.result;
        const signal = previous?.signal ?? proposedSignal;
        const emitted = !previous?.signal && !!proposedSignal;
        const legacy = !round || !!previous && (previous.legacy ?? true);
        store.put({ id, symbol: candidate.source.symbol, entryTime: candidate.enteredAt, signal, legacy }, [ownerKey, id]);
        history.add({ ...attempt, emitted, ...(round ? { roundId: round.id } : {}) }, historyKey);
        if (round) {
          const settings = tx.objectStore(SETTINGS);
          const roundKey = [...roundPrefix(owner), round.startedAt, round.id];
          const getRound = settings.get(roundKey);
          getRound.onsuccess = () => {
            const previousRound: RegretRound | undefined = getRound.result;
            const summary = previousRound ?? {
              ...round, plan: attempt.plan, additionCount: attempt.additionCount, observeHours: attempt.observeHours,
              done: 0, emitted: 0,
            };
            settings.put({ ...summary, done: summary.done + 1, emitted: summary.emitted + Number(emitted) }, roundKey);
          };
          settings.add(historyKey, [...roundRowsPrefix(owner, round.id), attempt.baseline.evaluatedAt, attempt.id]);
        }
        const entryKey = qualityEntryIdentity(candidate.source, candidate.enteredAt);
        const tableResult: ParallelTableResult = {
          entryKey, evaluatedAt: attempt.baseline.evaluatedAt, planLabel: attempt.plan.label,
          reason: attempt.simulation.reason, markerAt: attempt.marker?.observedAt, signal,
        };
        tx.objectStore(SETTINGS).put(tableResult, [...tablePrefix(owner), entryKey]);
        result(tableResult);
      };
    };
  });
}

const PAGE_SIZE = 40;
function page<T>(store: string, prefix: string[], before?: IDBValidKey, include?: (value: T) => boolean) {
  return transaction<{ rows: T[]; next?: IDBValidKey }>(store, 'readonly', (tx, result) => {
    const request = tx.objectStore(store).openCursor(
      IDBKeyRange.bound(prefix, before ?? [...prefix, []], true, true), 'prev',
    );
    const rows: T[] = [];
    let last: IDBValidKey | undefined;
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || rows.length === PAGE_SIZE) {
        result({ rows, next: cursor ? last : undefined });
        return;
      }
      if (!include || include(cursor.value)) rows.push(cursor.value);
      last = cursor.key;
      cursor.continue();
    };
  });
}

export const loadRegretDirectory = (owner?: string, before?: IDBValidKey) =>
  page<RegretCandidate>(CANDIDATES, [key(owner)], before);

export const loadRegretHistory = (owner: string | undefined, id: string, before?: IDBValidKey) =>
  page<ParallelAttempt & { emitted: boolean }>(HISTORY, [key(owner), id], before);


export function loadRegretCatalog(owner?: string) {
  return transaction<{ rounds: RegretRound[]; legacy: boolean; edits: LibraryDirectoryEdits }>(
    [SETTINGS, CANDIDATES], 'readonly', (tx, result) => {
      const settings = tx.objectStore(SETTINGS);
      const catalog = { rounds: [] as RegretRound[], legacy: false, edits: {} as LibraryDirectoryEdits };
      result(catalog);
      const rounds = settings.getAll(prefixRange(roundPrefix(owner)));
      rounds.onsuccess = () => { catalog.rounds = rounds.result; };
      const edits = settings.get(regretEditsKey(owner));
      edits.onsuccess = () => { catalog.edits = edits.result ?? {}; };
      const candidates = tx.objectStore(CANDIDATES).openCursor(prefixRange([key(owner)]));
      candidates.onsuccess = () => {
        const cursor = candidates.result;
        if (!cursor) return;
        if ((cursor.value as RegretCandidate).legacy !== false) catalog.legacy = true;
        else cursor.continue();
      };
    },
  );
}

export function editRegretDirectory(owner: string | undefined, id: string, change: { name: string } | { hidden: boolean }) {
  return transaction<LibraryDirectoryEdits>(SETTINGS, 'readwrite', (tx, result) => {
    const store = tx.objectStore(SETTINGS), storageKey = regretEditsKey(owner);
    const request = store.get(storageKey);
    request.onsuccess = () => {
      const previous: LibraryDirectoryEdits = request.result ?? {};
      const existing = previous[id];
      const next = 'name' in change ? renameLibraryDirectoryEdit(previous, id, change.name) ?? previous
        : { ...previous, [id]: { ...existing, hidden: change.hidden, at: Math.max(Date.now(), (existing?.at ?? 0) + 1) } };
      store.put(next, storageKey);
      result(next);
    };
  });
}

export const loadLegacyRegretAttempts = (owner?: string, before?: IDBValidKey) =>
  page<RegretAttempt>(HISTORY, [key(owner)], before, item => !item.roundId);

export const loadRegretAttempts = (owner?: string, before?: IDBValidKey) =>
  page<RegretAttempt>(HISTORY, [key(owner)], before);

export function loadRegretRound(owner: string | undefined, id: string, before?: IDBValidKey) {
  const prefix = roundRowsPrefix(owner, id);
  return transaction<{ rows: RegretAttempt[]; next?: IDBValidKey }>([SETTINGS, HISTORY], 'readonly', (tx, result) => {
    const cursor = tx.objectStore(SETTINGS).openCursor(IDBKeyRange.bound(prefix, before ?? [...prefix, []], true, true), 'prev');
    const history = tx.objectStore(HISTORY);
    const rows: RegretAttempt[] = [];
    let last: IDBValidKey | undefined;
    cursor.onsuccess = () => {
      const item = cursor.result;
      if (!item || rows.length === PAGE_SIZE) {
        result({ rows, next: item ? last : undefined });
        return;
      }
      const record = history.get(item.value);
      record.onsuccess = () => {
        if (record.result) rows.push(record.result);
        last = item.key;
        item.continue();
      };
    };
  });
}


export interface RegretImportReceipt {
  round: RegretRound;
  proposed: number;
  alreadyImported: boolean;
}

/** Import is atomic and leaves the current combination-table results untouched. */
export async function importRegretArchive(owner: string, archive: import('./regretArchive').RegretArchive): Promise<RegretImportReceipt> {
  if (!owner) throw Error('请登录后导入后悔库');
  const {round, attempts, digest} = archive;
  const ownerKey = key(owner);
  const receiptKey = ['regret-import', ownerKey, round.id];
  const roundKey = [...roundPrefix(owner), round.startedAt, round.id];
  const rowsRange = prefixRange(roundRowsPrefix(owner, round.id));
  const receipt = await transaction<RegretImportReceipt | undefined>([SETTINGS, HISTORY, CANDIDATES], 'readwrite', (tx, result) => {
    const settings = tx.objectStore(SETTINGS), history = tx.objectStore(HISTORY), candidates = tx.objectStore(CANDIDATES);
    const request = settings.get(receiptKey);
    request.onsuccess = () => {
      const previous = request.result as {digest: string; receipt: RegretImportReceipt} | undefined;
      if (previous) {
        if (previous.digest === digest) result({...previous.receipt, alreadyImported: true});
        return;
      }
      const occupied = settings.count(rowsRange);
      occupied.onsuccess = () => {
        if (occupied.result) return;
        const summary: RegretRound = {...round, plan: attempts[0].plan, additionCount: attempts[0].additionCount, observeHours: attempts[0].observeHours, done: 0, emitted: 0};
        let proposed = 0;
        const insert = () => {
          const attempt = attempts[summary.done];
          if (!attempt) {
            const receipt = {round: summary, proposed, alreadyImported: false};
            settings.add(summary, roundKey);
            settings.add({digest, receipt}, receiptKey);
            result(receipt);
            return;
          }
          const {candidate, proposedSignal} = attempt;
          const id = candidate.signalId ?? candidate.id;
          const existing = candidates.get([ownerKey, id]);
          existing.onsuccess = () => {
            const saved: RegretCandidate | undefined = existing.result;
            const emitted = !saved?.signal && !!proposedSignal;
            proposed += Number(!!proposedSignal);
            summary.emitted += Number(emitted);
            if (!saved || emitted) candidates.put({
              id, symbol: candidate.source.symbol, entryTime: candidate.enteredAt,
              signal: saved?.signal ?? proposedSignal, legacy: saved ? saved.legacy ?? true : false,
            }, [ownerKey, id]);
            const historyKey = [ownerKey, id, attempt.baseline.evaluatedAt, attempt.id];
            history.add({...attempt, emitted, roundId: round.id}, historyKey);
            settings.add(historyKey, [...roundRowsPrefix(owner, round.id), attempt.baseline.evaluatedAt, attempt.id]);
            summary.done++;
            insert();
          };
        };
        insert();
      };
    };
  });
  if (!receipt) throw Error('已有同编号的不同归档，无法导入');
  const count = await transaction<number>(SETTINGS, 'readonly', (tx, result) => {
    const read = tx.objectStore(SETTINGS).count(rowsRange);
    read.onsuccess = () => result(read.result);
  });
  if (count !== round.total || count !== receipt.round.done) throw Error('导入后读取的记录数不符');
  return receipt;
}
