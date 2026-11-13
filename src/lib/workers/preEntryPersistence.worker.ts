import { writePreEntrySnapshot } from '../fish/preEntryPersistence';
import type { PreEntryLibrary } from '../fish/preEntryMonitor';

self.onmessage = async (event: MessageEvent<{ owner?: string; delta: PreEntryLibrary; immediate?: boolean }>) => {
  try { await writePreEntrySnapshot(event.data.owner, event.data.delta, event.data.immediate); self.postMessage({ ok: true }); }
  catch (error) { self.postMessage({ ok: false, error: error instanceof Error ? error.message : '入选库保存失败' }); }
};
