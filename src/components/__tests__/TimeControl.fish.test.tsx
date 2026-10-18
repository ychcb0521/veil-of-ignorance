import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { TimeControl } from '@/components/TimeControl';
import { FISH_STORAGE_KEY, loadFishSignals } from '@/lib/fishSignals';
import { SIGNAL_LIBRARY_STORAGE_KEY } from '@/lib/signalLibrary';
import { initialFishProgress } from '@/lib/fishScanner';
import type { TradeSignal } from '@/lib/signalLibrary';
import { notifyPersistedStateHydrated } from '@/lib/persistedStateStorage';

const mocks = vi.hoisted(() => ({ scan: vi.fn(), push: vi.fn() }));
vi.mock('@/lib/fishScanner', async original => ({ ...await original<typeof import('@/lib/fishScanner')>(), FishScanner: class { scan = mocks.scan; } }));
vi.mock('@/lib/simStateSync', () => ({ queueSimStatePush: mocks.push }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'fish-owner' } }) }));
vi.mock('@/contexts/TradingContext', () => ({ useTradingContext: () => ({ tradeHistory: [], positionsMap: {}, priceMap: {}, getEffectiveTime: () => 0, getTimelineId: () => null }) }));
vi.mock('@/lib/journalApi', () => ({ listAllCampaigns: vi.fn(async () => []) }));
vi.mock('@/components/journal/PreTradeSnapshotDialog', () => ({ PreTradeSnapshotDialog: () => null }));
vi.mock('@/lib/signalJumpDiagnostics', async original => ({ ...await original<typeof import('@/lib/signalJumpDiagnostics')>(), preflightSignalJumpIssues: vi.fn(async () => new Map()) }));
const SIGNAL: TradeSignal = { id: 'fish-AAAUSDT-123', symbol: 'AAAUSDT', timeMs: 123, timeLabel: '2026-10-19 08:00:00', fallbackZone: '', fish: { average: 0.35, cbi2: 0.4, startAverage: 0.31, previousAverage: 0.29, threshold: 0.3, cutoffMs: 123 } };
function control(jump = vi.fn(async () => ({ ok: true as const }))) {
  return <TimeControl status="paused" currentSimulatedTime={123} speed={1} onStart={() => {}} onPause={() => {}} onResume={() => {}} onStop={() => {}} onSetSpeed={() => {}} onJumpToSignal={jump} />;
}
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  localStorage.setItem(SIGNAL_LIBRARY_STORAGE_KEY,'[]');
  localStorage.setItem(FISH_STORAGE_KEY,JSON.stringify([SIGNAL]));
  mocks.scan.mockImplementation(async o => { const p = { ...initialFishProgress(), cutoffMs: 123, total: 1, done: 1, status: 'complete' as const }; o.onSignal(SIGNAL); o.onProgress(p); return p; });
});
describe('TimeControl 渔入口与独立信号列表', { timeout: 30000 }, () => {
  it('按钮紧邻信号库并互斥，评分/删除独立，行和工具栏去重加入信号库，悬停有读数', async () => {
    render(control());
    const fishButton = screen.getByRole('button',{name:/^渔/});
    expect(fishButton.previousElementSibling).toHaveTextContent('信号库');
    expect(fishButton).toHaveTextContent('1');
    fireEvent.click(fishButton);
    const panel = screen.getByTestId('fish-panel');
    expect(within(panel).getByText('AAAUSDT').closest('.group')).toHaveAttribute('title',expect.stringContaining('0.35000000'));
    expect(within(panel).getByText('AAAUSDT').closest('button')).toHaveAttribute('title',expect.stringContaining('0.35000000'));
    fireEvent.click(within(panel).getByRole('radio',{name:'4 星'}));
    expect(loadFishSignals()[0].quality).toBe(4);
    expect(mocks.push).toHaveBeenLastCalledWith('fish-owner','fish_signals_v1',expect.any(Array));
    fireEvent.click(within(panel).getByRole('button',{name:'加入信号库'}));
    fireEvent.click(within(panel).getByRole('button',{name:'全部加入信号库'}));
    await waitFor(() => expect(JSON.parse(localStorage.getItem(SIGNAL_LIBRARY_STORAGE_KEY)!)).toHaveLength(1));
    expect(JSON.parse(localStorage.getItem(SIGNAL_LIBRARY_STORAGE_KEY)!)[0].quality).toBe(4);
    fireEvent.click(screen.getByRole('button',{name:/^信号库/}));
    expect(screen.queryByTestId('fish-panel')).not.toBeInTheDocument();
    fireEvent.click(fishButton);
    expect(screen.queryByText('上传 / 粘贴信号')).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId('fish-panel')).getByTitle('删除该信号'));
    expect(loadFishSignals()).toHaveLength(0);
    expect(JSON.parse(localStorage.getItem(SIGNAL_LIBRARY_STORAGE_KEY)!)).toHaveLength(1);
  });
  it('沿用信号跳转，成功后收起渔；云端延迟恢复可刷新徽标和列表', async () => {
    const jump = vi.fn(async () => ({ ok: true as const })); render(control(jump));
    fireEvent.click(screen.getByRole('button',{name:/^渔/}));
    fireEvent.click(within(screen.getByTestId('fish-panel')).getByText('AAAUSDT'));
    await waitFor(() => expect(jump).toHaveBeenCalledWith('AAAUSDT',123));
    expect(screen.queryByTestId('fish-panel')).not.toBeInTheDocument();
    localStorage.setItem(FISH_STORAGE_KEY,JSON.stringify([SIGNAL,{...SIGNAL,id:'fish-BBB',symbol:'BBBUSDT',timeMs:456}]));
    act(() => notifyPersistedStateHydrated(FISH_STORAGE_KEY));
    expect(screen.getByRole('button',{name:/^渔/})).toHaveTextContent('2');
  });
  it('扫描只在点击后开始，重复命中去重，可取消', async () => {
    render(control()); expect(mocks.scan).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:/^渔/}));
    fireEvent.click(screen.getByRole('button',{name:'开始捕捞'}));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('捕捞完成'));
    expect(loadFishSignals()).toHaveLength(1);
    let aborted = false;
    mocks.scan.mockImplementation(async o => { o.onProgress(initialFishProgress()); await new Promise<void>(resolve => o.signal.addEventListener('abort',() => { aborted = true; resolve(); },{once:true})); const result = { ...initialFishProgress(), status:'cancelled' as const }; o.onProgress(result); return result; });
    fireEvent.click(screen.getByRole('button',{name:'开始捕捞'}));
    await waitFor(() => expect(screen.getByRole('button',{name:'取消'})).toBeEnabled());
    fireEvent.click(screen.getByRole('button',{name:'取消'}));
    await waitFor(() => expect(aborted).toBe(true));
    expect(screen.getByRole('status')).toHaveTextContent('已取消');
  });
});
