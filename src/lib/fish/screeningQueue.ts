import type { TradeSignal } from '@/lib/signalLibrary';
import { readPersistedStateRaw, writePersistedStateRaw } from '@/lib/persistedStateStorage';
import { readFishPreferenceEntries, readFishPreferences, writeFishPreference } from './fishPreferencesDb';
import type { PreEntrySettings } from './preEntryMonitor';

const QUEUE_KEY = 'veil.fish-screening-queue.v1:';
export const screeningQueuePrefix = (owner: string) => QUEUE_KEY + encodeURIComponent(owner) + ':';
export const screeningQueueJobKey = (prefix: string, key: string) =>
  key.startsWith(prefix + 'job:') || key.startsWith(prefix + 'instant-job:');
const diskPrefix = (prefix: string) => 'idb:' + prefix;

export interface ScreeningJob {
  key: string;
  id: string;
  source: TradeSignal;
  settings?: PreEntrySettings;
  instantTrading?: true;
  nextCheckAt: number;
  nextMailAt?: number;
  matched?: true;
  mailFailures?: number;
  sent?: string[];
  failures?: number;
  runner?: string;
}

export type ScreeningQueueValue = (ScreeningJob | { done: true }) & { revision?: number };
export const isScreeningJob = (value: ScreeningQueueValue | undefined): value is ScreeningJob =>
  !!value && 'source' in value;

export function readLocalScreeningValue(key: string): ScreeningQueueValue | undefined {
  try {
    const value = JSON.parse(readPersistedStateRaw(key) ?? 'null');
    if (value?.done === true) return { done: true, revision: value.revision };
    if (value?.source && value.key === key && typeof value.id === 'string') return value;
  } catch { /* Leave malformed legacy entries intact. */ }
}

export function readLocalScreeningQueue(prefix: string): Map<string, ScreeningQueueValue> {
  const entries = new Map<string, ScreeningQueueValue>();
  try {
    for (const key of Object.keys(localStorage)) {
      if (!screeningQueueJobKey(prefix, key)) continue;
      const value = readLocalScreeningValue(key);
      if (value) entries.set(key, value);
    }
  } catch { /* IndexedDB and pending session writes can still supply the queue. */ }
  return entries;
}

export async function readScreeningQueue(prefix: string): Promise<Map<string, ScreeningQueueValue>> {
  const local = readLocalScreeningQueue(prefix);
  if (typeof indexedDB === 'undefined') return local;
  for (const [suffix, value] of await readFishPreferenceEntries<ScreeningQueueValue>(diskPrefix(prefix))) {
    const key = prefix + suffix;
    if (screeningQueueJobKey(prefix, key) && (value.revision ?? 0) >= (local.get(key)?.revision ?? 0)) local.set(key, value);
  }
  return local;
}

export async function readScreeningValue(key: string): Promise<ScreeningQueueValue | undefined> {
  const local = readLocalScreeningValue(key);
  if (typeof indexedDB === 'undefined') return local;
  try {
    const [stored] = await readFishPreferences<ScreeningQueueValue>(['idb:' + key]);
    if (stored && (stored.revision ?? 0) >= (local?.revision ?? 0)) return stored;
  } catch { /* Existing local data can continue while IndexedDB is unavailable. */ }
  return local;
}

function writeCompatibilityReceipt(key: string, revision: number) {
  try {
    const existing = localStorage.getItem(key);
    if (existing === null || (readLocalScreeningValue(key)?.revision ?? 0) <= revision) {
      if (existing !== '{"done":true}') localStorage.setItem(key, '{"done":true}');
    }
  } catch { /* Compatibility marker is best effort when browser storage is full. */ }
}

/** Commit to IndexedDB first. An old page sees a compact receipt after handoff. */
export async function writeScreeningQueueValue(prefix: string, key: string, value: ScreeningQueueValue): Promise<boolean> {
  if (typeof indexedDB !== 'undefined') {
    try {
      await writeFishPreference('idb:' + key, value);
      writeCompatibilityReceipt(key, value.revision ?? 0);
      if (key.startsWith(prefix + 'instant-job:')) {
        writeCompatibilityReceipt(prefix + 'job:' + key.slice((prefix + 'instant-job:').length), value.revision ?? 0);
      }
      return true;
    } catch { /* Fall back to the previous storage when IndexedDB is unavailable. */ }
  }
  const saved = writePersistedStateRaw(key, JSON.stringify(value));
  if (saved && key.startsWith(prefix + 'instant-job:')) {
    writeCompatibilityReceipt(prefix + 'job:' + key.slice((prefix + 'instant-job:').length), value.revision ?? 0);
  }
  return saved;
}
