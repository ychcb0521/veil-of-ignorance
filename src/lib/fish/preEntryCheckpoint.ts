import type { PreEntryLibrary } from './preEntryMonitor';

/** Hook snapshots are immutable. Send only changed objects, while the existing
 * store still merges into the complete, backwards-compatible v6 library. */
export function preEntryCheckpointDelta(previous: PreEntryLibrary | undefined, next: PreEntryLibrary): PreEntryLibrary {
  if (!previous) return next;
  const changed = <T extends { id: string }>(before: T[], after: T[]) => {
    const old = new Map(before.map(item => [item.id, item]));
    return after.filter(item => old.get(item.id) !== item);
  };
  return {
    version: 1,
    rounds: changed(previous.rounds, next.rounds),
    records: changed(previous.records, next.records),
    ...(previous.settings !== next.settings ? { settings: next.settings } : {}),
    ...(previous.settingsHistory !== next.settingsHistory ? { settingsHistory: next.settingsHistory } : {}),
    ...(previous.directoryEdits !== next.directoryEdits ? { directoryEdits: next.directoryEdits } : {}),
  };
}

/** One write in flight and one latest snapshot, never a queue of cloned archives.
 * A failed write does not advance the checkpoint; retry includes all unsaved data. */
export function createPreEntryCheckpoint(write: (delta: PreEntryLibrary) => Promise<void>) {
  let saved: PreEntryLibrary | undefined, pending: PreEntryLibrary | undefined;
  let active: Promise<void> | undefined;
  return {
    save(value: PreEntryLibrary): Promise<void> {
      pending = value;
      if (!active) {
        active = Promise.resolve().then(async () => {
          try { while (pending) {
            const snapshot = pending; pending = undefined;
            const delta = preEntryCheckpointDelta(saved, snapshot);
            if (delta.records.length || delta.rounds.length || delta.settings || delta.settingsHistory || delta.directoryEdits) await write(delta);
            saved = snapshot;
          } } finally { active = undefined; pending = undefined; }
        });
      }
      return active;
    },
  };
}
