import type { AccountBlobAdapter } from './accountBlobSync';
import { getUserId } from './userStoragePrefix';

export const TURING_REPLAY_MINUTE_MS = 60_000;
export const TURING_REPLAY_TICK_SIZE = 0.01;
export type TuringReopen = 'lunch' | 'session-gap';
type Minute = [number, number, number, number, number, number, number, number];

export interface TuringReplayArchive {
  version: 1;
  anchorMs: number;
  minutes: number;
  markets: Record<string, (Minute | null)[]>;
  reopens: [number, TuringReopen][];
}

export type TuringReplayQuery = { startTime?: number; endTime?: number; limit?: number };

const MAX_MINUTES = 100_000;
const MAX_MARKETS = 500;

function isReopen(value: unknown): value is TuringReopen {
  return value === 'lunch' || value === 'session-gap';
}

export function turingReplayFields(row: readonly unknown[]): { turingReopen?: TuringReopen } {
  const metadata = row[11];
  if (!metadata || typeof metadata !== 'object' || !('turingReplayVersion' in metadata)
    || metadata.turingReplayVersion !== 1 || !('reopen' in metadata) || !isReopen(metadata.reopen)) return {};
  return { turingReopen: metadata.reopen };
}

function isMinute(row: unknown): row is Minute {
  if (!Array.isArray(row) || row.length !== 8 || !row.every(Number.isFinite)) return false;
  const [open, high, low, close, volume, quote, buy, buyQuote] = row;
  return row.slice(0, 4).every(Number.isSafeInteger) && low > 0
    && low <= Math.min(open, close) && high >= Math.max(open, close)
    && buy >= 0 && buy <= volume && buyQuote >= 0 && buyQuote <= quote;
}

export function parseTuringReplayArchive(json: string): TuringReplayArchive {
  return validateTuringReplayArchive(JSON.parse(json));
}

function validateTuringReplayArchive(value: unknown): TuringReplayArchive {
  const input = value as TuringReplayArchive;
  if (!input || input.version !== 1 || !Number.isSafeInteger(input.anchorMs) || input.anchorMs <= 0
    || input.anchorMs % TURING_REPLAY_MINUTE_MS || !Number.isInteger(input.minutes)
    || input.minutes <= 0 || input.minutes > MAX_MINUTES
    || !input.markets || typeof input.markets !== 'object' || Array.isArray(input.markets)
    || !Array.isArray(input.reopens)) throw Error('图灵杯连续行情文件格式无效');

  const markets = Object.entries(input.markets);
  if (!markets.length || markets.length > MAX_MARKETS || !markets.every(([ticker, rows]) => (
    /^[A-Z0-9][A-Z0-9 _.\-]{0,39}$/.test(ticker) && Array.isArray(rows)
    && rows.length === input.minutes && rows.some(row => row !== null) && rows.every(row => row === null || isMinute(row))
  ))) throw Error('图灵杯连续行情的标的或价量格式无效');

  let previous = 0;
  for (const entry of input.reopens) {
    if (!Array.isArray(entry) || entry.length !== 2 || !Number.isInteger(entry[0])
      || entry[0] <= previous || entry[0] >= input.minutes || !isReopen(entry[1])) {
      throw Error('图灵杯连续行情的开市边界无效');
    }
    previous = entry[0];
  }
  return input;
}

const intervalMinutes: Record<string, number> = {
  '1m': 1, '3m': 3, '5m': 5, '15m': 15, '30m': 30, '1h': 60, '2h': 120,
  '4h': 240, '6h': 360, '8h': 480, '12h': 720, '1d': 1440, '3d': 4320, '1w': 10080,
};

function bucketStart(time: number, interval: string, width: number): number {
  if (interval === '1M') {
    const date = new Date(time);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  }
  const offset = interval === '1w' ? 4 * 1440 * TURING_REPLAY_MINUTE_MS : 0;
  return Math.floor((time - offset) / width) * width + offset;
}

function nextBucket(time: number, interval: string, width: number): number {
  if (interval !== '1M') return time + width;
  const date = new Date(time);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
}

function visibleReopens(archive: TuringReplayArchive, series: (Minute | null)[]) {
  const byMinute = new Map<number, TuringReopen>();
  for (const [i, [start, reason]] of archive.reopens.entries()) {
    const end = archive.reopens[i + 1]?.[0] ?? archive.minutes;
    for (let slot = start; slot < end; slot++) {
      if ((series[slot]?.[4] ?? 0) > 0) {
        byMinute.set(slot, reason);
        break;
      }
    }
  }
  return byMinute;
}

export function readArchiveKlines(
  archive: TuringReplayArchive, ticker: string, interval: string, query: TuringReplayQuery,
): unknown[][] {
  const series = archive.markets[ticker];
  const width = intervalMinutes[interval] * TURING_REPLAY_MINUTE_MS;
  if (!series || (!Number.isFinite(width) && interval !== '1M')) return [];
  const from = Math.max(archive.anchorMs, query.startTime ?? archive.anchorMs);
  const archiveEnd = archive.anchorMs + archive.minutes * TURING_REPLAY_MINUTE_MS;
  const to = Math.min(archiveEnd - 1, query.endTime ?? archiveEnd - 1);
  const limit = Math.max(1, Math.min(1500, Math.floor(query.limit ?? 1000)));
  const reopens = visibleReopens(archive, series);
  const rows: unknown[][] = [];
  let time = bucketStart(from, interval, width);
  if (time < from) time = nextBucket(time, interval, width);
  for (; time <= to; time = nextBucket(time, interval, width)) {
    const end = nextBucket(time, interval, width);
    if (end > archiveEnd) break;
    const startSlot = (time - archive.anchorMs) / TURING_REPLAY_MINUTE_MS;
    const endSlot = (end - archive.anchorMs) / TURING_REPLAY_MINUTE_MS;
    const first = series[startSlot];
    const last = series[endSlot - 1];
    if (!first || !last) continue;
    let [, high, low] = first;
    let volume = 0, quote = 0, buy = 0, buyQuote = 0;
    let slot = startSlot;
    for (; slot < endSlot; slot++) {
      const minute = series[slot];
      if (!minute) break;
      high = Math.max(high, minute[1]);
      low = Math.min(low, minute[2]);
      volume += minute[4];
      quote += minute[5];
      buy += minute[6];
      buyQuote += minute[7];
    }
    if (slot !== endSlot) continue;
    const price = (ticks: number) => (ticks * TURING_REPLAY_TICK_SIZE).toFixed(2);
    const reopen = interval === '1m' ? reopens.get(startSlot) : undefined;
    rows.push([time, price(first[0]), price(high), price(low), price(last[3]), volume, end - 1,
      quote, null, buy, buyQuote, reopen ? { turingReplayVersion: 1, reopen } : null]);
    if (query.startTime != null && rows.length === limit) break;
  }
  return rows.slice(-limit);
}

type ArchiveSync = Pick<typeof import('./accountBlobSync'), 'syncAccountBlobOnLoad' | 'noteAccountBlobSaved' | 'syncAccountBlobFully'>;
let accountSync: ArchiveSync | undefined;

// Workers share the archive parsers. Only the signed-in app initializes cloud storage.
export function connectTuringReplayArchiveSync(sync: ArchiveSync): void {
  accountSync = sync;
}

const databaseName = 'veil-turing-replay-v1';
const storeName = 'archives';
let cached: { accountId: string; archive: Promise<TuringReplayArchive | undefined> } | undefined;

function openStorage(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readStorage(accountId: string): Promise<TuringReplayArchive | undefined> {
  const db = await openStorage();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(storeName, 'readonly').objectStore(storeName).get(accountId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export const TURING_REPLAY_ARCHIVE_CHANGED = 'veil-turing-replay-archive-changed';

async function writeStorage(accountId: string, archive: TuringReplayArchive): Promise<void> {
  const db = await openStorage();
  try {
    if (accountId !== getUserId()) throw Error('账号已切换，请重新选择行情文件');
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readwrite');
      transaction.objectStore(storeName).put(archive, accountId);
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
  if (accountId === getUserId()) {
    cached = { accountId, archive: Promise.resolve(archive) };
    window.dispatchEvent(new CustomEvent(TURING_REPLAY_ARCHIVE_CHANGED, { detail: accountId }));
  }
}

const accountArchive: AccountBlobAdapter<TuringReplayArchive> = {
  name: 'turing-replay-archive-v1',
  read: readStorage,
  async write(owner, archive) {
    if (archive) await writeStorage(owner, validateTuringReplayArchive(archive));
  },
  weight: archive => archive ? Object.keys(archive.markets).length * archive.minutes : 0,
};

export function loadTuringReplayArchive(accountId = getUserId()): Promise<TuringReplayArchive | undefined> {
  if (!accountId || accountId !== getUserId() || typeof indexedDB === 'undefined') return Promise.resolve(undefined);
  if (cached?.accountId === accountId) return cached.archive;
  const archive = readStorage(accountId).then(async local => {
    if (!accountSync) return local;
    const status = await accountSync.syncAccountBlobOnLoad(accountArchive, accountId, 45_000);
    if (accountId !== getUserId()) return undefined;
    if (status === 'adopted') return readStorage(accountId);
    if (status === 'failed' || status === 'timed_out') {
      if (!local) throw Error('暂时无法读取账号行情，请重试');
      if (cached?.archive === archive) cached = undefined;
    }
    return local;
  }).catch(error => {
    if (cached?.archive === archive) cached = undefined;
    throw error;
  });
  cached = { accountId, archive };
  return archive;
}

export async function importTuringReplayArchive(accountId: string, file: File): Promise<TuringReplayArchive> {
  if (!accountId || accountId !== getUserId()) throw Error('请先登录图灵杯');
  if (file.size > 100 * 1024 * 1024) throw Error('图灵杯行情文件超过 100 MB');
  const archive = parseTuringReplayArchive(await file.text());
  await cached?.archive.catch(() => undefined);
  await writeStorage(accountId, archive);
  return archive;
}

export async function saveTuringReplayArchiveToAccount(accountId: string): Promise<boolean> {
  if (!accountSync || accountId !== getUserId()) return false;
  await accountSync.noteAccountBlobSaved(accountArchive, accountId);
  const status = await accountSync.syncAccountBlobFully(accountArchive, accountId);
  return accountId === getUserId() && (status === 'pushed' || status === 'unchanged');
}
