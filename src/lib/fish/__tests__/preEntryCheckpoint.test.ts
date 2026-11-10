import { expect, it, vi } from 'vitest';
import { createPreEntryCheckpoint, preEntryCheckpointDelta } from '../preEntryCheckpoint';
import { emptyPreEntryLibrary, mergePreEntryLibraries, type PreEntryLibrary, type PreEntryRecord } from '../preEntryMonitor';
import {withPreEntryTableClears} from '../preEntryTableClears';

const record = (id: string, at = 1): PreEntryRecord => ({ id, roundId: 'r', status: 'scanning', startTime: 1, cursor: at, updatedAt: at, readings: [],
  sample: { id, source: { id, symbol: 'TESTUSDT', timeMs: 1, timeLabel: '', fallbackZone: '' }, groups: [], importedAt: 1, enteredAt: 1, basis: 'signal' },
  exclusionProcess: { version: 1, startedAt: 1, entries: [{ kind: 'observation', stage: 'exclusion', status: 'blocked', from: 1, through: at, count: at, reason: '未收复高点' }] } });
const library = (): PreEntryLibrary => ({ ...emptyPreEntryLibrary(), rounds: [{ id: 'r', state: 'running', startedAt: 1, updatedAt: 1, filters: [], hours: 48 }], records: [record('a'), record('b')] });
it('does not resend cleared histories on the next start but still includes every real unsaved observation',async()=>{
 const before=library(),write=vi.fn(async(_delta:PreEntryLibrary)=>{}),checkpoint=createPreEntryCheckpoint(write,true);checkpoint.seed(before);
 const cleared=withPreEntryTableClears(before,{a:10,b:10});await checkpoint.save(cleared);expect(write.mock.calls[0][0].records).toEqual([]);expect(write.mock.calls[0][0].tableClears).toEqual({a:10,b:10});
 const progress={...cleared,records:[{...cleared.records[0],cursor:20,updatedAt:20},cleared.records[1],record('c')]};await checkpoint.save(progress);expect(write.mock.calls[1][0].records.map(r=>r.id)).toEqual(['a','c']);
});

it('seeds the durable library so starting a round does not resend already saved histories',async()=>{
 const before=library(),write=vi.fn(async(_delta:PreEntryLibrary)=>{}),checkpoint=createPreEntryCheckpoint(write);checkpoint.seed(before);
 const round={id:'new',state:'running' as const,startedAt:3,updatedAt:3,filters:[],hours:48},next=mergePreEntryLibraries(before,{version:1,rounds:[round],records:[{...record('c'),roundId:'new'}]});
 expect(next.records[0]).toBe(before.records[0]);await checkpoint.save(next);expect(write.mock.calls[0][0].records.map(r=>r.id)).toEqual(['c']);expect(write.mock.calls[0][0].rounds).toEqual([round]);
});

it('merges changed rows without copying untouched histories or changing frozen settings', () => {
  const before = library(); before.settings = { updatedAt: 1, plans: [], hours: 48 };
  const next = { ...before, records: [record('a', 20), before.records[1]] };
  const delta = preEntryCheckpointDelta(before, next);
  expect(delta.records).toEqual([next.records[0]]); expect(delta.rounds).toEqual([]); expect(delta.settings).toBeUndefined();
  expect(mergePreEntryLibraries(before, delta)).toEqual(next);
  expect(before.records[0].cursor).toBe(1);
});

it('holds only one in-flight write and the latest complete checkpoint under 1000 rapid updates', async () => {
  let durable = emptyPreEntryLibrary(), release!: () => void;
  const write = vi.fn(async (delta: PreEntryLibrary) => {
    if (write.mock.calls.length === 2) await new Promise<void>(resolve => { release = resolve; });
    durable = mergePreEntryLibraries(durable, delta);
  });
  const checkpoint = createPreEntryCheckpoint(write), initial = library(); await checkpoint.save(initial);
  let next = { ...initial, records: [record('a', 2), initial.records[1]] };
  const saving = checkpoint.save(next); await Promise.resolve();
  for (let i = 3; i <= 1002; i++) {
    next = { ...next, records: [record('a', i), record('b', i)] };
    expect(checkpoint.save(next)).toBe(saving);
  }
  expect(write).toHaveBeenCalledTimes(2);
  release(); await saving;
  expect(write).toHaveBeenCalledTimes(3); expect(durable).toEqual(next);
  expect(durable.records.every(r => r.exclusionProcess?.entries[0].through === 1002)).toBe(true);
});

it('keeps unsaved records for retry after failure and flushes pause, clear marks and directory edits', async () => {
  let durable = emptyPreEntryLibrary();
  const write = vi.fn(async (delta: PreEntryLibrary) => { durable = mergePreEntryLibraries(durable, delta); });
  const checkpoint = createPreEntryCheckpoint(write), before = library(); await checkpoint.save(before);
  const progress = { ...before, records: [record('a', 10), before.records[1]] };
  write.mockRejectedValueOnce(Error('磁盘繁忙')); await expect(checkpoint.save(progress)).rejects.toThrow('磁盘繁忙');
  const stopped: PreEntryLibrary = { ...progress, rounds: [{ ...before.rounds[0], state: 'paused', updatedAt: 20 }], records: progress.records.map(r => ({ ...r, tableClearedAt: 20 })) };
  await checkpoint.save(stopped); expect(durable).toEqual(stopped);
  expect(durable.records[0].cursor).toBe(10); expect(durable.records[0].exclusionProcess).toEqual(progress.records[0].exclusionProcess);
});

it('does not lose a save submitted as the previous checkpoint resolves', async () => {
  let durable = emptyPreEntryLibrary();
  const checkpoint = createPreEntryCheckpoint(async delta => { durable = mergePreEntryLibraries(durable, delta); });
  const first = library();
  await checkpoint.save(first);
  const next = { ...first, records: [record('a', 50), first.records[1]] };
  await checkpoint.save(next); expect(durable).toEqual(next);
});
