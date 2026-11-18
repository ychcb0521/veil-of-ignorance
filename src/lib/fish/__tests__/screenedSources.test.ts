import { expect, it } from 'vitest';
import { screenedSourceKeys, isScreenedSource } from '../screenedSources';
import type { PreEntryLibrary, PreEntryRecord } from '../preEntryMonitor';
import type { TradeSignal } from '../../signalLibrary';

const source: TradeSignal = { id: 'original', symbol: 'AAAUSDT', timeMs: 60000, timeLabel: '', fallbackZone: '' };
const record: PreEntryRecord = { id: 'entry', roundId: 'auto', sample: { id: 'sample', source, groups: [], enteredAt: 60000, importedAt: 60000, basis: 'signal' },
  status: 'matched', matchedAt: 120000, startTime: 60000, cursor: 120000, updatedAt: 120000, readings: [] };
const library: PreEntryLibrary = { version: 1, records: [record], rounds: [{ id: 'auto', automatic: true, state: 'complete', startedAt: 60000, updatedAt: 120000, hours: 1, filters: [] }] };

it('advances only the admitted source signal, preserving later signals and other venues', () => {
  const before = JSON.stringify(library);
  const keys = screenedSourceKeys(library);
  expect(isScreenedSource({ ...source, id: 'recaptured' }, keys)).toBe(true);
  expect(isScreenedSource({ ...source, timeMs: 180000 }, keys)).toBe(false);
  expect(isScreenedSource({ ...source, exchange: 'okx' }, keys)).toBe(false);
  expect(JSON.stringify(library)).toBe(before);
});
it('keeps pending, rejected and manual research signals in new fish', () => {
  for (const status of ['scanning', 'unmatched', 'error', 'warming'] as const) {
    expect(screenedSourceKeys({ ...library, records: [{ ...record, status }] }).size).toBe(0);
  }
  expect(screenedSourceKeys({ ...library, rounds: [{ ...library.rounds[0], automatic: false }] }).size).toBe(0);
});
it('continues excluding admitted history after a sale and supports original signal time', () => {
  const derived = { ...source, timeMs: 120000, preEntryMonitor: { recordId: 'old', roundId: 'old', sourceId: source.id, sourceTime: 60000, matchedAt: 120000 } };
  expect(isScreenedSource(source, screenedSourceKeys({ ...library, records: [{ ...record, sample: { ...record.sample, source: derived } }] }))).toBe(true);
});
