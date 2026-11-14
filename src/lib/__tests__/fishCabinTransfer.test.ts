import { expect, it } from 'vitest';
import { mergeCabinImport, parseCabinFile } from '@/lib/fish/cabinTransfer';
import { stringifyLibraryFile } from '@/lib/fish/libraryTransfer';
import { migrateFishSignal, fishDedupKey } from '@/lib/fish/records';
import { applyFishTombstones, mergeFishLists } from '@/lib/fish/tombstones';
import type { TradeSignal } from '@/lib/signalLibrary';

it('restores a deleted cabin occurrence only through explicit import and preserves original evidence', () => {
  const at = 1_750_000_000_000;
  const fish = migrateFishSignal({ id: 'test', symbol: 'BTCUSDT', timeMs: at - 60_000, timeLabel: '', fallbackZone: '',
    caughtAt: at, fishArchive: { id: 'test-round', at }, quality: 4 });
  const original = { ...fish, fish: { ...fish.fish!, algorithms: [{ featureId: 'cbi2', value: NaN }] } } as TradeSignal;
  const rows = parseCabinFile(stringifyLibraryFile({ format: 'veil-fish-cabin', version: 1, exportedAt: at, records: [original] }));
  expect(rows).toEqual([original]);
  const deleted = { [fishDedupKey(original)]: at + 1 };
  expect(mergeFishLists([], rows, deleted)).toEqual([]);
  const imported = mergeCabinImport([], rows, deleted, at + 2);
  expect(imported.added).toBe(1);
  expect(imported.signals[0]).toEqual({ ...original, cabinImportedAt: at + 2 });
  expect(mergeCabinImport(imported.signals, rows, deleted, at + 3).skipped).toBe(1);
  expect(mergeFishLists(rows, imported.signals, deleted)).toEqual(imported.signals);
  expect(applyFishTombstones(imported.signals, { [fishDedupKey(original)]: at + 4 })).toEqual([]);
});

it('rejects library files and malformed cabin records', () => {
  const envelope = { format: 'veil-fish-cabin', version: 1, exportedAt: 1, records: [{}] };
  expect(() => parseCabinFile(JSON.stringify(envelope))).toThrow('格式无效');
  expect(() => parseCabinFile(JSON.stringify({ ...envelope, records: [], format: 'veil-fish-quality-libraries' }))).toThrow('格式无效');
});
