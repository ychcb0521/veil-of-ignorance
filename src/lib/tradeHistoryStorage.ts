// The IndexedDB base is immutable for the lifetime of a page. A synchronous
// edit journal keeps the existing synchronous readers and unload writes durable.
const prefix = '@veil/history/1:';
const historyKey = /^sim_[^_]+_(trade_history|cancelled_orders|filled_orders|trade_campaigns|campaign_counterfactuals)$/;
let initialized = false;
const dirty = new Set<string>();
let timer: ReturnType<typeof setTimeout> | undefined;
export function isTradeHistoryKey(key: string | null): key is string {
  return !!key && historyKey.test(key);
}

const bases = new Map<string, { id: string; raw: string }>();

function decode(key: string, stored: string) {
  const [id, start, end, replacement] = JSON.parse(stored.slice(prefix.length));
  const base = bases.get(key);
  if (!base || base.id !== id || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)
    || start < 0 || end < start || end > base.raw.length || typeof replacement !== 'string') {
    throw Error('交易历史的本机原文尚未核验');
  }
  return base.raw.slice(0, start) + replacement + base.raw.slice(end);
}

export function readHistoryAwareStorage(key: string): string | null {
  const stored = localStorage.getItem(key);
  return historyKey.test(key) && stored?.startsWith(prefix) ? decode(key, stored) : stored;
}

export function writeHistoryAwareStorage(key: string, raw: string) {
  const base = bases.get(key);
  if (!base) {
    localStorage.setItem(key, raw);
    if (historyKey.test(key)) scheduleCheckpoint(key);
    return;
  }
  let start = 0, end = base.raw.length, tail = raw.length;
  while (start < end && start < tail && base.raw[start] === raw[start]) start++;
  while (end > start && tail > start && base.raw[end-1] === raw[tail-1]) { end--; tail--; }
  const delta = prefix + JSON.stringify([base.id, start, end, raw.slice(start, tail)]);
  localStorage.setItem(key, delta.length < raw.length ? delta : raw);
  scheduleCheckpoint(key);
}

function openHistory(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('veil-trade-history', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('bases');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

async function snapshot(db: IDBDatabase, key: string, raw?: string): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const tx = raw === undefined ? db.transaction('bases', 'readonly') : db.transaction('bases', 'readwrite', { durability: 'strict' });
    const store = tx.objectStore('bases');
    const request = raw === undefined ? store.get(key) : store.add(raw, key);
    tx.oncomplete = () => resolve(raw === undefined ? request.result : undefined);
    tx.onabort = () => reject(tx.error ?? Error('本机交易历史写入中断'));
  });
}

async function onlyWindow(): Promise<boolean> {
  if (!navigator.serviceWorker) return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const channel = new MessageChannel();
  try {
    const probe = async () => {
      // A separate scope lets an existing app worker keep its registration.
      const registration = await navigator.serviceWorker.register('/history-windows.js', {scope:'/history-window-check/'});
      const worker = registration.active ?? registration.installing ?? registration.waiting;
      if (!worker) return false;
      if (worker.state !== 'activated') await new Promise<void>(resolve => {
        worker.addEventListener('statechange', () => {
          if (worker.state === 'activated' || worker.state === 'redundant') resolve();
        });
      });
      if (worker.state !== 'activated') return false;
      return new Promise<boolean>(resolve => {
        channel.port1.onmessage = e => resolve(e.data === true);
        worker.postMessage('history-window-count-v1', [channel.port2]);
      });
    };
    return await Promise.race([probe(), new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), 3000); })]);
  } catch { return false; }
  finally { clearTimeout(timer); channel.port1.close(); }
}

function scheduleCheckpoint(key: string) {
  if (!initialized || !navigator.locks) return;
  dirty.add(key);
  if (timer !== undefined) return;
  timer = setTimeout(() => {
    timer = undefined;
    const batch = [...dirty];
    dirty.clear();
    void navigator.locks.request('veil-trade-history-start', () => updateCheckpoints(batch, false)).catch(() => {
      // The synchronous journal remains authoritative through quota or connection failures.
    });
  }, 500);
}

function removeSnapshot(db: IDBDatabase, id: string) {
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('bases','readwrite');
    tx.objectStore('bases').delete(id);
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
}

async function updateCheckpoints(keys: string[], boot: boolean) {
  if (!keys.length) return;
  let db: IDBDatabase | undefined;
  try {
    if (boot) {
      for (const key of keys) {
        const stored = localStorage.getItem(key);
        if (!stored?.startsWith(prefix)) continue;
        const [id] = JSON.parse(stored.slice(prefix.length));
        db ??= await openHistory();
        const raw = await snapshot(db, key + '/' + id);
        if (typeof raw !== 'string') throw Error('未找到交易历史原文');
        bases.set(key, { id, raw });
        decode(key, stored);
      }
    }
    if (!navigator.locks) return;
    const candidates = keys.filter(key => {
      const stored = localStorage.getItem(key);
      if (!stored) return false;
      return !boot || stored.length >= 8192 || !stored.startsWith(prefix);
    });
    if (!candidates.length) return;
    const solo = await onlyWindow();
    for (const key of candidates) {
      const stored = localStorage.getItem(key);
      if (stored === null) continue;
      const raw = readHistoryAwareStorage(key)!;
      try {
        db ??= await openHistory();
        if (!solo) {
          // Keep a bounded replacement copy while a legacy tab may need the full original.
          const tx = db.transaction('bases','readwrite');
          tx.objectStore('bases').put(raw,'staged/'+key);
          await new Promise<void>((resolve,reject) => {tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});
          continue;
        }
        const id = crypto.randomUUID();
        const ref = key + '/' + id;
        await snapshot(db, ref, raw);
        let installed = false;
        try {
          if (await snapshot(db, ref) !== raw || !await onlyWindow() || localStorage.getItem(key) !== stored) continue;
          const previous = bases.get(key);
          localStorage.setItem(key, prefix + JSON.stringify([id, raw.length, raw.length, '']));
          bases.set(key, {id, raw});
          installed = true;
          if (previous) await removeSnapshot(db,key+'/'+previous.id);
          await removeSnapshot(db,'staged/'+key);
        } finally {
          if (!installed) await removeSnapshot(db, ref);
        }
      } catch { /* Keep the durable original, or its previous base and synchronous edit journal. */ }
    }
  } finally { db?.close(); }
}

export async function prepareTradeHistory() {
  const prepare = () => updateCheckpoints(Object.keys(localStorage).filter(key => historyKey.test(key)), true);
  if (navigator.locks) await navigator.locks.request('veil-trade-history-start', prepare);
  else await prepare();
  initialized = true;
}