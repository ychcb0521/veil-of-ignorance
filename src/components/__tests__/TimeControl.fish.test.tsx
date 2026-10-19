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
    fireEvent.click(screen.getByRole('button',{name:/^鱼/}));
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
    fireEvent.click(screen.getByRole('button',{name:/^鱼/}));
    fireEvent.click(within(screen.getByTestId('fish-panel')).getByTitle('删除该信号'));
    expect(loadFishSignals()).toHaveLength(0);
    expect(JSON.parse(localStorage.getItem(SIGNAL_LIBRARY_STORAGE_KEY)!)).toHaveLength(1);
  });
  it('沿用信号跳转，成功后收起渔；云端延迟恢复可刷新徽标和列表', async () => {
    const jump = vi.fn(async () => ({ ok: true as const })); render(control(jump));
    fireEvent.click(screen.getByRole('button',{name:/^渔/}));
    fireEvent.click(screen.getByRole('button',{name:/^鱼/}));
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
    expect(screen.getByLabelText('捕捞时间（UTC+8）')).toBeDisabled();
    expect(screen.getByLabelText('捕捞阈值')).toBeDisabled();
    fireEvent.click(screen.getByRole('button',{name:'取消'}));
    await waitFor(() => expect(aborted).toBe(true));
    expect(screen.getByRole('status')).toHaveTextContent('已取消');
  });
  it('输入历史时间与阈值，收起重开仍保留；校验输入并更新重复信号读数而保留评分', async () => {
    render(control());
    const toggle = screen.getByRole('button',{name:/^渔/});
    fireEvent.click(toggle);
    fireEvent.change(screen.getByLabelText('捕捞时间（UTC+8）'), { target: { value: '2026-10-18 12:34:56' } });
    fireEvent.change(screen.getByLabelText('捕捞阈值'), { target: { value: '0.2' } });
    fireEvent.click(toggle); fireEvent.click(toggle);
    expect(screen.getByLabelText('捕捞时间（UTC+8）')).toHaveValue('2026-10-18 12:34:56');
    expect(screen.getByLabelText('捕捞阈值')).toHaveValue(0.2);
    fireEvent.click(screen.getByRole('button',{name:/^鱼/}));
    fireEvent.click(screen.getByRole('radio',{name:'4 星'}));
    mocks.scan.mockImplementation(async o => { o.onSignal({ ...SIGNAL, fish: { ...SIGNAL.fish, threshold: o.threshold, cutoffMs: o.anchorMs, average: 0.25 } }); const p = { ...initialFishProgress(), anchorMs: o.anchorMs, cutoffMs: o.anchorMs, threshold: o.threshold, status: 'complete' }; o.onProgress(p); return p; });
    fireEvent.click(screen.getByRole('button',{name:'开始捕捞'}));
    await waitFor(() => expect(mocks.scan).toHaveBeenCalledWith(expect.objectContaining({ anchorMs: Date.UTC(2026,9,18,4,34,56), threshold: 0.2 })));
    expect(loadFishSignals()).toHaveLength(1);
    expect(loadFishSignals()[0]).toMatchObject({ id: SIGNAL.id, quality: 4, fish: { threshold: 0.2, average: 0.25 } });
    expect(screen.queryByText(/本轮阈值 > 0.2/)).not.toBeInTheDocument();
    const help = screen.getByRole('button',{name:'捕捞说明'});
    fireEvent.mouseOver(help);
    expect(screen.queryByRole('dialog',{name:'捕捞说明'})).not.toBeInTheDocument();
    fireEvent.click(help);
    expect(screen.getByRole('dialog',{name:'捕捞说明'})).toHaveTextContent('本轮阈值 > 0.2');
    fireEvent.keyDown(screen.getByRole('dialog',{name:'捕捞说明'}),{key:'Escape'});
    await waitFor(() => expect(screen.queryByRole('dialog',{name:'捕捞说明'})).not.toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('捕捞时间（UTC+8）'), { target: { value: '2026-02-30 12:00' } });
    fireEvent.click(screen.getByRole('button',{name:'开始捕捞'}));
    expect(screen.getByRole('alert')).toHaveTextContent('捕捞时间无效');
    expect(mocks.scan).toHaveBeenCalledTimes(1);
  });

  it('鱼位于渔内部，默认收起；复用信号库列头，按时间/标的/评分排序并按月筛选', async () => {
    const b = { ...SIGNAL, id: 'fish-BBB', symbol: 'BBBUSDT', quality: 5, timeMs: Date.UTC(2026,8,15), timeLabel: '2026-09-15 08:00:00' };
    const a = { ...SIGNAL, quality: 2, timeMs: Date.UTC(2026,9,19), timeLabel: '2026-10-19 08:00:00' };
    localStorage.setItem(FISH_STORAGE_KEY, JSON.stringify([b, a]));
    render(control());
    fireEvent.click(screen.getByRole('button',{name:/^渔/}));
    expect(screen.queryByTestId('fish-old-panel')).not.toBeInTheDocument();
    const button = screen.getByRole('button',{name:/^鱼/});
    expect(button).toHaveAttribute('aria-expanded','false');
    fireEvent.click(button);
    const library = screen.getByTestId('fish-old-panel');
    expect(screen.getByTestId('fish-panel')).toContainElement(library);
    expect(within(library).getByText('兜底区')).toBeInTheDocument();
    const first = () => within(library).getByTestId('signal-library-scroller').querySelector('.group')!;
    expect(first()).toHaveTextContent('AAAUSDT');
    fireEvent.click(within(library).getByTestId('signal-sort-标的'));
    expect(first()).toHaveTextContent('BBBUSDT');
    fireEvent.click(within(library).getByTestId('signal-sort-信号时间'));
    expect(first()).toHaveTextContent('AAAUSDT');
    fireEvent.click(within(library).getByTestId('signal-sort-评分'));
    expect(first()).toHaveTextContent('BBBUSDT');
    fireEvent.click(within(first() as HTMLElement).getByRole('radio',{name:'1 星'}));
    expect(first()).toHaveTextContent('BBBUSDT'); // same stable row behavior as 信号库
    fireEvent.change(screen.getByLabelText('鱼的月份'),{target:{value:'2026-09'}});
    expect(within(library).queryByText('AAAUSDT')).not.toBeInTheDocument();
    expect(first()).toHaveTextContent('BBBUSDT');
    fireEvent.change(screen.getByLabelText('筛选鱼信号'),{target:{value:'AAA'}});
    expect(within(library).getByText('没有匹配的标的。')).toBeInTheDocument();
    fireEvent.click(button);
    expect(screen.queryByTestId('fish-old-panel')).not.toBeInTheDocument();
    expect(loadFishSignals()).toHaveLength(2);
    expect(JSON.parse(localStorage.getItem(SIGNAL_LIBRARY_STORAGE_KEY)!)).toHaveLength(0);
  });


  it('【用户要求】2026-10-19 新鱼：开始捕捞时上一轮的新鱼归入「鱼」，这一轮捕到的放进「新鱼」；加入信号库不带新鱼标记', async () => {
    const b = { ...SIGNAL, id: 'fish-BBB', symbol: 'BBBUSDT', timeMs: 456 };
    mocks.scan.mockImplementation(async o => { o.onSignal(b); const p = { ...initialFishProgress(), status: 'complete' as const }; o.onProgress(p); return p; });
    render(control());
    fireEvent.click(screen.getByRole('button',{name:/^渔/}));
    expect(screen.getByRole('button',{name:/^新鱼/})).toHaveTextContent('0');
    fireEvent.click(screen.getByRole('button',{name:'开始捕捞'}));
    await waitFor(() => expect(screen.getByTestId('fish-new-panel')).toHaveTextContent('BBBUSDT'));
    expect(screen.getByRole('button',{name:/^鱼/})).toHaveTextContent('1');
    expect(loadFishSignals().filter(s => s.freshCatch).map(s => s.symbol)).toEqual(['BBBUSDT']);
    // 第二轮：命中 AAA（以前就有），BBB 归入鱼
    mocks.scan.mockImplementation(async o => { o.onSignal(SIGNAL); const p = { ...initialFishProgress(), status: 'complete' as const }; o.onProgress(p); return p; });
    fireEvent.click(screen.getByRole('button',{name:'开始捕捞'}));
    await waitFor(() => expect(loadFishSignals().filter(s => s.freshCatch).map(s => s.symbol)).toEqual(['AAAUSDT']));
    expect(loadFishSignals()).toHaveLength(2);
    expect(screen.getByTestId('fish-new-panel')).toHaveTextContent('AAAUSDT');
    expect(screen.getByTestId('fish-new-panel')).not.toHaveTextContent('BBBUSDT');
    // 「全部加入信号库」只加这个列表里的
    fireEvent.click(within(screen.getByTestId('fish-new-panel')).getByRole('button',{name:'全部加入信号库'}));
    await waitFor(() => expect(JSON.parse(localStorage.getItem(SIGNAL_LIBRARY_STORAGE_KEY)!)).toHaveLength(1));
    const lib = JSON.parse(localStorage.getItem(SIGNAL_LIBRARY_STORAGE_KEY)!);
    expect(lib[0].symbol).toBe('AAAUSDT');
    expect(lib[0].freshCatch).toBeUndefined();
  });
});
