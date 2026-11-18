import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { FishPanel, type FishPanelProps } from '../FishPanel';
import type { FishQualityState } from '@/hooks/useFishQuality';
import type { PreEntryLibrary, PreEntryRecord } from '@/lib/fish/preEntryMonitor';
import type { TradeSignal } from '@/lib/signalLibrary';
vi.mock('@/components/FishQuality', () => ({ FishQuality: () => null }));
vi.mock('@/components/FishLibraryDataManager', () => ({ FishLibraryDataManager: ({ children }: any) => children }));
vi.mock('@/hooks/useFishFeatures', () => ({ useFishFeatures: () => [] }));
afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); });

it('moves an admitted fish out of new fish rows and count without hiding later signals of that symbol', () => {
  sessionStorage.setItem('veil.fish.open', JSON.stringify({ catching: true }));
  const source: TradeSignal = { id: 'capture', symbol: 'AAAUSDT', timeMs: 60000, timeLabel: '', fallbackZone: '', freshCatch: true };
  const next = { ...source, id: 'later', timeMs: 180000 };
  const record: PreEntryRecord = { id: 'entry', roundId: 'auto', status: 'scanning', startTime: 60000, cursor: 60000, updatedAt: 60000, readings: [],
    sample: { id: 'sample', source, enteredAt: 60000, importedAt: 60000, basis: 'signal', groups: [] } };
  const library: PreEntryLibrary = { version: 1, records: [record], rounds: [{ id: 'auto', automatic: true, state: 'complete', hours: 1, filters: [], startedAt: 60000, updatedAt: 120000 }] };
  const props: FishPanelProps = { signals: [source, next], progress: null, inputs: { time: '', threshold: '' }, onInputsChange: vi.fn(),
    selection: { exchanges: ['binance'], includeDuplicates: false }, onSelectionChange: vi.fn(), onStart: vi.fn(), onCancel: vi.fn(), onJump: vi.fn(), onDelete: vi.fn(), onRate: vi.fn(),
    jumpingSignalId: null, tradedDayIndex: new Set(), campaignDayIndex: new Set() };
  const quality = (lib: PreEntryLibrary) => ({ preEntry: { library: lib } } as FishQualityState);
  const view = render(<FishPanel {...props} quality={quality(library)} />);
  expect(within(screen.getByTestId('fish-new')).getByRole('button', { name: /^新鱼\s*2$/ })).toBeInTheDocument();
  view.rerender(<FishPanel {...props} quality={quality({ ...library, records: [{ ...record, status: 'matched', matchedAt: 120000 }] })} />);
  expect(within(screen.getByTestId('fish-new')).getByRole('button', { name: /^新鱼\s*1$/ })).toBeInTheDocument();
  expect(props.signals).toEqual([source, next]);
});
