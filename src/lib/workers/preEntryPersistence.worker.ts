import { writePreEntrySnapshot } from '../fish/preEntryPersistence';
import type { PreEntryLibrary } from '../fish/preEntryMonitor';

self.onmessage = async (event: MessageEvent<{ owner?: string; delta: PreEntryLibrary }>) => {
  try { await writePreEntrySnapshot(event.data.owner, event.data.delta); self.postMessage({ ok: true }); }
  catch (error) { self.postMessage({ ok: false, error: error instanceof Error ? error.message : '入选库保存失败' }); }
};
