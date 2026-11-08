import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useFishQuality } from '../useFishQuality';
import { newQualityStudy, qualityDisplayRows, qualityRunSamples, type QualityRunOptions } from '@/lib/fish/quality';
import { emptyPreEntryLibrary, type PreEntryRecord } from '@/lib/fish/preEntryMonitor';
import type { TradeSignal } from '@/lib/signalLibrary';

vi.mock('@/lib/fish/qualityStore', () => ({ loadQualityStudy: async () => ({ study: newQualityStudy() }), saveQualityStudy: vi.fn(async () => true) }));
vi.mock('@/lib/fish/preEntryMonitorStore', () => ({ loadPreEntryLibrary: async () => ({ ...emptyPreEntryLibrary(), records: [record, {...record,id:'failed',status:'error'}, {...record,id:'queued',status:'queued'}] }), savePreEntryLibrary: vi.fn(async () => undefined) }));
vi.mock('@/lib/fish/preEntryMonitorV2Store', () => ({ loadPreEntryLibraryV2: async () => emptyPreEntryLibrary(), savePreEntryLibraryV2: vi.fn(async () => undefined) }));
vi.mock('@/lib/fish/preEntryMonitorV3Store', () => ({ loadPreEntryLibraryV3: async () => emptyPreEntryLibrary(), savePreEntryLibraryV3: vi.fn(async () => undefined) }));
vi.mock('@/lib/fish/preEntryMonitorV4Store', () => ({ loadPreEntryLibraryV4: async () => emptyPreEntryLibrary(), savePreEntryLibraryV4: vi.fn(async () => undefined) }));
vi.mock('@/lib/fish/preEntryMonitorV5Store', () => ({ loadPreEntryLibraryV5: async () => emptyPreEntryLibrary(), savePreEntryLibraryV5: vi.fn(async () => undefined) }));
const time = Date.UTC(2026, 2, 29, 5), matchedAt = time + 2 * 86400_000;
const record: PreEntryRecord = { id: 'matched', roundId: 'round', status: 'matched', startTime: time, cursor: matchedAt, matchedAt, updatedAt: time, readings: [],
  sample: { id: 'original', source: { id: 'source', symbol: 'TURING:TURING 50', timeMs: time, timeLabel: '', fallbackZone: '' }, groups: [], enteredAt: time, basis: 'signal', importedAt: time, origin: 'turing' } };
afterEach(cleanup);

it('automatically exposes restored matches as entry sources without selecting or starting monitoring', async () => {
  const empty: TradeSignal[] = [], run = vi.fn(async () => undefined);
  const hook = renderHook(() => useFishQuality('entry-sync-test', empty, run));
  await waitFor(() => expect(qualityDisplayRows(hook.result.current.study)).toHaveLength(1));
  const row = qualityDisplayRows(hook.result.current.study)[0];
  expect(row.source.preEntryMonitor?.recordId).toBe('matched');
  expect(row.enteredAt).toBe(matchedAt);
  expect(hook.result.current.study.samples[0].origin).toBe('pre-entry');
  expect(hook.result.current.study.selectedRowIds ?? []).toEqual([]);
  hook.rerender();
  expect(qualityDisplayRows(hook.result.current.study)).toHaveLength(1);
  expect(run).not.toHaveBeenCalled();
});

it('selects display rows from the selected library so the visible table can run holding monitoring', async () => {
  const empty: TradeSignal[] = [], tasks: QualityRunOptions[] = [];
  const { result } = renderHook(() => useFishQuality('entry-selection-test', empty, async options => { tasks.push(options); }));
  await waitFor(() => expect(result.current.ready && result.current.preEntry.ready).toBe(true));
  act(() => { expect(result.current.selectPreEntryRecords(['matched'])).toBe(1); });
  const visible = qualityDisplayRows(result.current.study);
  expect(visible).toHaveLength(1);
  expect(result.current.study.selectedRowIds).toEqual(visible.map(r => r.id));
  // FishQuality's visible-scope callback accepts displayed detector-row IDs, not merged IDs.
  act(() => result.current.setScope(visible.map(r => r.id)));
  await act(() => result.current.start());
  expect(tasks).toHaveLength(1);
  expect(qualityRunSamples(tasks[0].study)[0].enteredAt).toBe(matchedAt);
});
