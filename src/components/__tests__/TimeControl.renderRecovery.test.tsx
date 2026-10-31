import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { renderFishQuality as render } from '@/test/renderFishQuality';
import { TimeControl } from '@/components/TimeControl';
import { initialFishProgress, type FishProgress } from '@/lib/fishScanner';
import { saveFishAuto } from '@/lib/fish/autoScan';

const mocks = vi.hoisted(() => ({ scan: vi.fn(), broken: false }));
vi.mock('@/lib/fishScanner', async original => ({ ...await original<typeof import('@/lib/fishScanner')>(), FishScanner: class { scan = mocks.scan; isBusy = () => false; } }));
vi.mock('@/lib/simStateSync', () => ({ queueSimStatePush: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'recovery-owner' } }) }));
vi.mock('@/contexts/TradingContext', () => ({ useTradingContext: () => ({ tradeHistory: [], positionsMap: {}, priceMap: {}, getEffectiveTime: () => 0, getTimelineId: () => null }) }));
vi.mock('@/lib/journalApi', () => ({ listAllCampaigns: vi.fn(async () => []) }));
vi.mock('@/components/journal/PreTradeSnapshotDialog', () => ({ PreTradeSnapshotDialog: () => null }));
vi.mock('@/components/FishPanel', () => ({ FISH_DEFAULT_ALGORITHMS: ['cbi2'], FishPanel: p => {
  if (mocks.broken) throw new Error('模拟渔面板显示异常');
  return <><button onClick={() => p.onStart({})}>开始捕捞</button><output data-testid="capture-progress">{p.progress?.done ?? 0}</output></>;
} }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); sessionStorage.clear(); });

it('keeps the actual capture controller alive while the fish panel is recovered', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {}); saveFishAuto({ mode: 'manual', hours: 1, lastRunAt: Date.now() });
  let task!: { signal: AbortSignal; onProgress: (p: FishProgress) => void }, finish!: () => void;
  mocks.broken = false; mocks.scan.mockImplementation(async options => { task = options; await new Promise<void>(resolve => { finish = resolve; }); return initialFishProgress(); });
  render(<TimeControl status="paused" currentSimulatedTime={123} speed={1} onStart={() => {}} onPause={() => {}} onResume={() => {}} onStop={() => {}} onSetSpeed={() => {}}/>);
  fireEvent.click(screen.getByRole('button', { name: /^渔/ })); fireEvent.click(screen.getByRole('button', { name: '开始捕捞' }));
  await waitFor(() => expect(mocks.scan).toHaveBeenCalledTimes(1));
  mocks.broken = true; act(() => task.onProgress({ ...initialFishProgress(), done: 1, total: 2 }));
  expect(screen.getByRole('alert')).toHaveTextContent('渔显示暂时异常'); expect(task.signal.aborted).toBe(false);
  act(() => task.onProgress({ ...initialFishProgress(), done: 2, total: 2 }));
  mocks.broken = false; fireEvent.click(screen.getByRole('button', { name: '恢复渔显示' }));
  expect(screen.getByTestId('capture-progress')).toHaveTextContent('2'); expect(task.signal.aborted).toBe(false); expect(mocks.scan).toHaveBeenCalledTimes(1);
  await act(async () => { finish(); });
});
