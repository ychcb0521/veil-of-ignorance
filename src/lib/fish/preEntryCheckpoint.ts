import type { PreEntryLibrary } from './preEntryMonitor';

/** Hook snapshots are immutable. Send only changed objects, while the existing
 * store still merges into the complete, backwards-compatible v6 library. */
export function preEntryCheckpointDelta(previous: PreEntryLibrary | undefined, next: PreEntryLibrary, displayMarksSavedSeparately=false): PreEntryLibrary {
  if (!previous) return next;
  const changed = <T extends { id: string }>(before: T[], after: T[]) => {
    const old = new Map(before.map(item => [item.id, item]));
    return after.filter(item => old.get(item.id) !== item);
  };
  const oldRecords=new Map(previous.records.map(record=>[record.id,record]));
  const records=changed(previous.records,next.records).filter(record=>{
    if(!displayMarksSavedSeparately)return true;
    const old=oldRecords.get(record.id);if(!old)return true;
    // A successful metadata-only erase wraps records but does not modify their
    // histories. Starting afterwards must not clone those histories again.
    const keys=Object.keys(record).filter(key=>key!=='tableClearedAt');
    return keys.length!==Object.keys(old).filter(key=>key!=='tableClearedAt').length||keys.some(key=>record[key]!==old[key]);
  });
  return {
    version: 1,
    rounds: changed(previous.rounds, next.rounds),
    records,
    ...(previous.settings !== next.settings ? { settings: next.settings } : {}),
    ...(previous.settingsHistory !== next.settingsHistory ? { settingsHistory: next.settingsHistory } : {}),
    ...(previous.directoryEdits !== next.directoryEdits ? { directoryEdits: next.directoryEdits } : {}),
    ...(previous.tableClears !== next.tableClears ? { tableClears: next.tableClears } : {}),
  };
}

/** One write in flight and one latest snapshot, never a queue of cloned archives.
 * A failed write does not advance the checkpoint; retry includes all unsaved data. */
export function createPreEntryCheckpoint(write: (delta: PreEntryLibrary) => Promise<void>, displayMarksSavedSeparately=false) {
  let saved: PreEntryLibrary | undefined, pending: PreEntryLibrary | undefined;
  let active: Promise<void> | undefined;
  return {
    /** Already durable v6 rows are not copied again when starting another round. */
    seed(value: PreEntryLibrary) { if (!active && !saved) saved = value; },
    save(value: PreEntryLibrary): Promise<void> {
      pending = value;
      if (!active) {
        active = Promise.resolve().then(async () => {
          try { while (pending) {
            const snapshot = pending; pending = undefined;
            const delta = preEntryCheckpointDelta(saved, snapshot, displayMarksSavedSeparately);
            if (delta.records.length || delta.rounds.length || delta.settings || delta.settingsHistory || delta.directoryEdits || delta.tableClears) await write(delta);
            saved = snapshot;
          } } finally { active = undefined; pending = undefined; }
        });
      }
      return active;
    },
  };
}
