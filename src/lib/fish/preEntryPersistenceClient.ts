import {serializeArchiveWork} from '../serializeArchiveWork';
import type { PreEntryLibrary } from './preEntryMonitor';
import { writePreEntrySnapshot } from './preEntryPersistence';

async function persistSnapshot(owner: string | undefined, delta: PreEntryLibrary, immediate = false): Promise<void> {
  if (typeof Worker === 'undefined') return writePreEntrySnapshot(owner, delta, immediate);
  return new Promise<void>((resolve, reject) => {
    const worker = new Worker(new URL('../workers/preEntryPersistence.worker.ts', import.meta.url), { type: 'module' });
    let settled = false;
    const finish = (error?: Error) => { if (settled) return; settled = true; clearTimeout(timer); worker.terminate(); if (error) reject(error); else resolve(); };
    const timer = setTimeout(() => finish(Error('入选库保存超时，未确认的进度将保留以便重试')), 120_000);
    worker.onmessage = (event: MessageEvent<{ ok: boolean; error?: string }>) => finish(event.data?.ok ? undefined : Error(event.data?.error ?? '入选库保存失败'));
    worker.onerror = () => finish(Error('入选库后台保存失败，请保留页面并重试'));
    worker.onmessageerror = () => finish(Error('入选库后台保存消息读取失败'));
    try { worker.postMessage(immediate ? { owner, delta, immediate } : { owner, delta }); } catch (error) { finish(error instanceof Error ? error : Error('入选库保存失败')); }
  });
}

export function persistPreEntrySnapshot(owner: string | undefined, delta: PreEntryLibrary, immediate = false): Promise<void> {
  // An automatic checkpoint contains one round and row. IndexedDB merges it atomically
  // with bulk writes, so it can start without waiting for archive workers or backups.
  return immediate ? persistSnapshot(owner, delta, true) : serializeArchiveWork(() => persistSnapshot(owner, delta));
}
