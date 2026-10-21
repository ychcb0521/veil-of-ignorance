import { saveFishAuto } from '@/lib/fish/autoScan';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { TimeControl } from '@/components/TimeControl';
import { FISH_STORAGE_KEY } from '@/lib/fishSignals';
import { SIGNAL_LIBRARY_STORAGE_KEY, type TradeSignal } from '@/lib/signalLibrary';
import { saveFishPreference } from '@/lib/fish/preferences';
import type { FishReconstructionMetrics, FishReconstructionOptions, FishReconstructionResult } from '@/lib/fish/reconstruction';

const mocks = vi.hoisted(() => ({ reconstruct: vi.fn(), scan: vi.fn(), suggest: vi.fn(), push: vi.fn() }));
vi.mock('@/lib/fishScanner', async original => ({ ...await original<typeof import('@/lib/fishScanner')>(), FishScanner: class { reconstruct = mocks.reconstruct; scan = mocks.scan; suggest = mocks.suggest; } }));
vi.mock('@/lib/simStateSync', () => ({ queueSimStatePush: mocks.push }));
vi.mock('@/hooks/useFishFeatures', async () => { const { CBI2_DEF } = await import('@/lib/deepDig/features'); const defs = [{ ...CBI2_DEF, formula: 'avg_X = avg(C, 1)' }]; return { useFishFeatures: () => defs }; });
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'reconstruction-owner' } }) }));
vi.mock('@/contexts/TradingContext', () => ({ useTradingContext: () => ({ tradeHistory: [], positionsMap: {}, priceMap: {}, getEffectiveTime: () => 0, getTimelineId: () => null }) }));
vi.mock('@/lib/journalApi', () => ({ listAllCampaigns: vi.fn(async () => []) }));
vi.mock('@/components/journal/PreTradeSnapshotDialog', () => ({ PreTradeSnapshotDialog: () => null }));
vi.mock('@/lib/signalJumpDiagnostics', async original => ({ ...await original<typeof import('@/lib/signalJumpDiagnostics')>(), preflightSignalJumpIssues: vi.fn(async () => new Map()) }));
const time = Date.UTC(2026, 9, 19, 0);
const row = (id: string, symbol: string, offset: number): TradeSignal => ({ id, symbol, timeMs: time + offset, timeLabel: `2026-10-19 08:${String(offset / 60000).padStart(2, '0')}:00`, fallbackZone: '' });
const library = [row('library-a', 'AAAUSDT', 0), row('library-b', 'BBBUSDT', 300000)];
const catches = [row('old-fish', 'OLDUSDT', 600000), { ...row('new-fish', 'NEWUSDT', 900000), freshCatch: true }];
const metrics: FishReconstructionMetrics = { total: 2, valid: 2, skipped: { gap: 0, history: 0, retention: 0, failed: 0, readings: 0 }, strictHits: 2, looseHits: 2, strictRate: 1, looseRate: 1, noiseStarts: 0, matchedStarts: 2, totalStarts: 2, coinDays: 3, noiseRate: 0, precision: 1, f1: 1 };
function resultFor(options: FishReconstructionOptions): FishReconstructionResult {
  return { createdAt: time, fingerprint: 'library-only-fixture', algorithms: [{ key: 'fixture', algorithmKey: 'fixture', featureId: 'cbi2', label: 'LIBRARY', statistic: '结果', unit: '', step: 300000, currentThreshold: .3, bestThreshold: .023, train: metrics, test: metrics, scan: [{ threshold: .023, train: metrics, test: metrics }], perSignal: options.signals.map((s, i) => ({ id: s.id, key: s.id, symbol: s.symbol, timeMs: s.timeMs, split: i === 0 ? 'train' : 'test', reading: .4, best: { reading: .4, start: s.timeMs, strict: true, loose: true, active: true, unknown: false }, current: { reading: .4, start: s.timeMs, strict: true, loose: true, active: true, unknown: false } })) }] };
}
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear();
  saveFishAuto({mode:'manual',hours:1,lastRunAt:null});
  localStorage.setItem(SIGNAL_LIBRARY_STORAGE_KEY, JSON.stringify(library));
  localStorage.setItem(FISH_STORAGE_KEY, JSON.stringify(catches));
  saveFishPreference('cbi2', { statistic: '结果', direction: '>', threshold: '.3', constraints: [] });
  mocks.reconstruct.mockImplementation(async (options: FishReconstructionOptions) => resultFor(options));
});
afterEach(cleanup);

it('复原的评估与噪音标签只接收 Time Machine 旁的信号库，匹配列不进入鱼或新鱼', async () => {
  render(<TimeControl status="paused" currentSimulatedTime={time} speed={1} onStart={() => {}} onPause={() => {}} onResume={() => {}} onStop={() => {}} onSetSpeed={() => {}} onJumpToSignal={vi.fn(async () => ({ ok: true as const }))}/>);
  expect(mocks.reconstruct).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: /^信号库/ })).toHaveTextContent('2');
  fireEvent.click(screen.getByRole('button', { name: /^渔/ }));
  expect(mocks.reconstruct).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'更多'}));fireEvent.click(screen.getByRole('button', { name: '复原' }));
  await waitFor(() => expect(mocks.reconstruct).toHaveBeenCalledTimes(1));
  const options = mocks.reconstruct.mock.calls[0][0] as FishReconstructionOptions;
  expect(options.signals).toEqual(library);
  expect(options.signals.map(s => s.symbol)).not.toContain('OLDUSDT');
  expect(options.signals.map(s => s.symbol)).not.toContain('NEWUSDT');
  await waitFor(() => expect(screen.getByTestId('fish-reconstruction-results')).toBeVisible());
  expect(mocks.scan).not.toHaveBeenCalled(); expect(mocks.suggest).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: /^鱼/ }));
  for (const id of ['fish-new-panel', 'fish-old-panel']) {
    const panel = screen.getByTestId(id);
    expect(within(panel).queryByText('匹配')).toBeNull();
    expect(within(panel).queryByTestId('signal-reconstruction-match')).toBeNull();
  }
  expect(within(screen.getByTestId('fish-new-panel')).getByText('NEWUSDT')).toBeVisible();
  expect(within(screen.getByTestId('fish-old-panel')).getByText('OLDUSDT')).toBeVisible();

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^信号库/ })); });
  const main = screen.getByTestId('signal-library-panel');
  expect(within(main).getByText('匹配', { selector: 'span' })).toBeVisible();
  const matches = within(main).getAllByTestId('signal-reconstruction-match');
  expect(matches).toHaveLength(library.length);
  for (const match of matches) expect(match).toHaveTextContent('LIBRARY > 0.023');
  expect(within(main).queryByText('OLDUSDT')).toBeNull(); expect(within(main).queryByText('NEWUSDT')).toBeNull();
  expect(JSON.parse(localStorage.getItem(SIGNAL_LIBRARY_STORAGE_KEY)!)).toEqual(library);
}, 30000);

// 【用户要求】2026-10-19「匹配之后为何还是这样」：「匹配」下拉只选门槛口径、不计算；信号库里直接给出复原入口与进度
it('信号库没复原过：写「尚未复原」并给出「复原」按钮，点了就算，算完匹配列有内容', async () => {
  render(<TimeControl status="paused" currentSimulatedTime={time} speed={1} onStart={() => {}} onPause={() => {}} onResume={() => {}} onStop={() => {}} onSetSpeed={() => {}} onJumpToSignal={vi.fn(async () => ({ ok: true as const }))}/>);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^信号库/ })); });
  const main = screen.getByTestId('signal-library-panel');
  expect(within(main).getByText('尚未复原')).toBeVisible();
  fireEvent.change(within(main).getByLabelText('匹配门槛'), { target: { value: 'current' } });
  expect(mocks.reconstruct).not.toHaveBeenCalled();
  fireEvent.click(within(main).getByTestId('library-reconstruction-start'));
  await waitFor(() => expect(mocks.reconstruct).toHaveBeenCalledTimes(1));
  expect((mocks.reconstruct.mock.calls[0][0] as FishReconstructionOptions).signals).toEqual(library);
  fireEvent.change(within(main).getByLabelText('匹配门槛'), { target: { value: 'best' } });
  await waitFor(() => expect(within(main).getAllByTestId('signal-reconstruction-match')[0]).toHaveTextContent('LIBRARY > 0.023'));
  expect(within(main).queryByText('尚未复原')).toBeNull();
}, 30000);
