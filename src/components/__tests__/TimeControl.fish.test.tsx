import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { TimeControl } from '@/components/TimeControl';
import { FISH_STORAGE_KEY, loadFishSignals } from '@/lib/fishSignals';
import { SIGNAL_LIBRARY_STORAGE_KEY } from '@/lib/signalLibrary';
import { initialFishProgress } from '@/lib/fishScanner';
import type { TradeSignal } from '@/lib/signalLibrary';
import { notifyPersistedStateHydrated } from '@/lib/persistedStateStorage';
import { saveFishAuto } from '@/lib/fish/autoScan';
import { archiveFishForNextRound } from '@/lib/fish/records';
import { saveFishPreference } from '@/lib/fish/preferences';

const mocks = vi.hoisted(() => ({ scan: vi.fn(), push: vi.fn() }));
vi.mock('@/lib/fishScanner', async original => ({ ...await original<typeof import('@/lib/fishScanner')>(), FishScanner: class { scan = mocks.scan; isBusy = () => false; } }));
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
  vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear();
  // 这些用例验证手动捕捞流程；自动默认值和调度另由 useFishAutoScan 测试覆盖。
  saveFishAuto({mode:'manual',hours:1,lastRunAt:null});
  localStorage.setItem(SIGNAL_LIBRARY_STORAGE_KEY,'[]');
  localStorage.setItem(FISH_STORAGE_KEY,JSON.stringify([SIGNAL]));
  // 阈值默认留空（等信号库的建议填，或手动输入）；这里按用户已填过 0.3 测捕捞流程
  saveFishPreference('cbi2',{statistic:'结果',direction:'>',threshold:'0.3',constraints:[]});
  mocks.scan.mockImplementation(async o => { const p = { ...initialFishProgress(), cutoffMs: 123, total: 1, done: 1, status: 'complete' as const }; o.onSignal(SIGNAL); o.onProgress(p); return p; });
});
describe('TimeControl 渔入口与独立信号列表', { timeout: 30000 }, () => {
  it('按钮紧邻信号库并互斥，评分/删除独立，无加入信号库入口，不显示快照悬停框', async () => {
    render(control());
    const fishButton = screen.getByRole('button',{name:/^渔/});
    expect(fishButton.previousElementSibling).toHaveTextContent('信号库');
    expect(fishButton).toHaveTextContent('1');
    fireEvent.click(fishButton);
    const panel = screen.getByTestId('fish-panel');
    expect(within(panel).getByText('AAAUSDT').closest('.group')).not.toHaveAttribute('title');
    expect(within(panel).getByText('AAAUSDT').closest('button')).not.toHaveAttribute('title',expect.stringContaining('0.35000000'));
    fireEvent.click(within(panel).getByRole('radio',{name:'4 星'}));
    expect(loadFishSignals()[0].quality).toBe(4);
    expect(mocks.push).toHaveBeenLastCalledWith('fish-owner','fish_signals_v1',expect.any(Array));
    expect(within(panel).queryByRole('button',{name:/加入信号库/})).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(SIGNAL_LIBRARY_STORAGE_KEY)!)).toHaveLength(0);
    fireEvent.click(screen.getByRole('button',{name:/^信号库/}));
    expect(screen.queryByTestId('fish-panel')).not.toBeInTheDocument();
    fireEvent.click(fishButton);
    expect(screen.queryByText('上传 / 粘贴信号')).not.toBeInTheDocument();
    // 【用户要求】2026-10-21「不能轻易删除」：点 × 先变成「确认删除」，再点一次才删
    fireEvent.click(within(screen.getByTestId('fish-panel')).getByTitle('删除该信号'));
    expect(loadFishSignals()).toHaveLength(1);
    fireEvent.click(within(screen.getByTestId('fish-panel')).getByRole('button',{name:/^确认删除/}));
    expect(loadFishSignals()).toHaveLength(0);
    expect(JSON.parse(localStorage.getItem(SIGNAL_LIBRARY_STORAGE_KEY)!)).toHaveLength(0);
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
    expect(loadFishSignals()).toHaveLength(2);
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
  it('输入历史时间与阈值，收起重开仍保留；校验输入；同一信号换阈值再捕到合并成一条并保留原评分', async () => {
    render(control());
    const toggle = screen.getByRole('button',{name:/^渔/});
    fireEvent.click(toggle);
    fireEvent.change(screen.getByLabelText('捕捞时间（UTC+8）'), { target: { value: '2026-10-18 12:34:56' } });
    fireEvent.change(screen.getByLabelText('捕捞阈值'), { target: { value: '0.2' } });
    fireEvent.click(toggle); fireEvent.click(toggle);
    expect(screen.getByLabelText('捕捞时间（UTC+8）')).toHaveValue('2026-10-18 12:34:56');
    expect(screen.getByLabelText('捕捞阈值')).toHaveValue(0.2);
    fireEvent.click(screen.getByRole('radio',{name:'4 星'}));
    mocks.scan.mockImplementation(async o => { o.onSignal({ ...SIGNAL, fish: { ...SIGNAL.fish, threshold: o.threshold, cutoffMs: o.anchorMs, average: 0.25 } }); const p = { ...initialFishProgress(), anchorMs: o.anchorMs, cutoffMs: o.anchorMs, threshold: o.threshold, status: 'complete' }; o.onProgress(p); return p; });
    fireEvent.click(screen.getByRole('button',{name:'开始捕捞'}));
    await waitFor(() => expect(mocks.scan).toHaveBeenCalledWith(expect.objectContaining({ anchorMs: Date.UTC(2026,9,18,4,34,56), threshold: 0.2 })));
    // 【用户要求】2026-10-21「整行完全重复时，只留一个」：同一信号只换了阈值，列表里显示一样——合并成一条，读数用这一轮的，评分沿用
    expect(loadFishSignals()).toHaveLength(2);
    expect(loadFishSignals().find(s=>s.freshCatch)).toMatchObject({quality:4,freshCatch:true,fish:{threshold:.2,average:.25}});
    expect(loadFishSignals().filter(s=>s.fishArchive)).toHaveLength(1);
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

  it('鱼舱位于渔内部，默认展开；复用信号库列头，按时间/标的/评分排序并按月筛选', async () => {
    const b = { ...SIGNAL, id: 'fish-BBB', symbol: 'BBBUSDT', quality: 5, timeMs: Date.UTC(2026,8,15), timeLabel: '2026-09-15 08:00:00' };
    const a = { ...SIGNAL, quality: 2, timeMs: Date.UTC(2026,9,19), timeLabel: '2026-10-19 08:00:00' };
    localStorage.setItem(FISH_STORAGE_KEY, JSON.stringify([b, a]));
    render(control());
    fireEvent.click(screen.getByRole('button',{name:/^渔/}));
    expect(screen.getByTestId('fish-old-panel')).toBeInTheDocument();
    const button = screen.getByRole('button',{name:/^鱼舱/});
    expect(button).toHaveAttribute('aria-expanded','true');
    const library = screen.getByTestId('fish-old-panel');
    expect(screen.getByTestId('fish-panel')).toContainElement(library);
    // 鱼的第三列是「算法类型」（2026-10-20 替换兜底区）
    expect(within(library).getByText('算法类型')).toBeInTheDocument();expect(within(library).queryByText('兜底区')).toBeNull();
    const first = () => within(library).getByTestId('signal-library-scroller').querySelector('.group')!;
    // 【用户要求】2026-10-21 默认按信号时间、最近的在上面
    expect(first()).toHaveTextContent('AAAUSDT');
    fireEvent.click(within(library).getByTestId('signal-sort-信号时间'));
    expect(first()).toHaveTextContent('BBBUSDT');
    fireEvent.click(within(library).getByTestId('signal-sort-标的'));
    expect(first()).toHaveTextContent('AAAUSDT');
    fireEvent.click(within(library).getByTestId('signal-sort-评分'));
    expect(first()).toHaveTextContent('BBBUSDT');
    fireEvent.click(within(first() as HTMLElement).getByRole('radio',{name:'1 星'}));
    expect(first()).toHaveTextContent('BBBUSDT'); // same stable row behavior as 信号库
    fireEvent.change(screen.getByLabelText('鱼舱的月份'),{target:{value:'2026-09'}});
    expect(within(library).queryByText('AAAUSDT')).not.toBeInTheDocument();
    expect(first()).toHaveTextContent('BBBUSDT');
    fireEvent.change(screen.getByLabelText('筛选鱼舱信号'),{target:{value:'AAA'}});
    expect(within(library).getByText('没有匹配的标的。')).toBeInTheDocument();
    fireEvent.click(button);
    expect(screen.queryByTestId('fish-old-panel')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:/^渔/}));
    fireEvent.click(screen.getByRole('button',{name:/^渔/}));
    expect(screen.queryByTestId('fish-old-panel')).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:/^鱼舱/}));
    expect(screen.getByLabelText('鱼舱的月份')).toHaveValue('2026-09');
    expect(screen.getByLabelText('筛选鱼舱信号')).toHaveValue('AAA');
    expect(loadFishSignals()).toHaveLength(2);
    expect(JSON.parse(localStorage.getItem(SIGNAL_LIBRARY_STORAGE_KEY)!)).toHaveLength(0);
  });


  it('【用户要求】2026-10-19 新鱼：开始捕捞时上一轮的新鱼归入「鱼」，这一轮捕到的放进「新鱼」；不提供加入信号库入口', async () => {
    const b = { ...SIGNAL, id: 'fish-BBB', symbol: 'BBBUSDT', timeMs: 456 };
    mocks.scan.mockImplementation(async o => { o.onSignal(b); const p = { ...initialFishProgress(), status: 'complete' as const }; o.onProgress(p); return p; });
    render(control());
    fireEvent.click(screen.getByRole('button',{name:/^渔/}));
    expect(screen.getByRole('button',{name:/^新鱼/})).toHaveTextContent('0');
    fireEvent.click(screen.getByRole('button',{name:'开始捕捞'}));
    await waitFor(() => expect(screen.getByTestId('fish-new-panel')).toHaveTextContent('BBBUSDT'));
    expect(screen.getByRole('button',{name:/^鱼舱/})).toHaveTextContent('1');
    expect(loadFishSignals().filter(s => s.freshCatch).map(s => s.symbol)).toEqual(['BBBUSDT']);
    // 第二轮：命中 AAA（以前就有），BBB 归入鱼
    mocks.scan.mockImplementation(async o => { o.onSignal(SIGNAL); const p = { ...initialFishProgress(), status: 'complete' as const }; o.onProgress(p); return p; });
    fireEvent.click(screen.getByRole('button',{name:'开始捕捞'}));
    await waitFor(() => expect(loadFishSignals().filter(s => s.freshCatch).map(s => s.symbol)).toEqual(['AAAUSDT']));
    expect(loadFishSignals()).toHaveLength(3);
    expect(loadFishSignals().filter(s=>s.fishArchive)).toHaveLength(2);
    expect(screen.getByTestId('fish-new-panel')).toHaveTextContent('AAAUSDT');
    expect(screen.getByTestId('fish-new-panel')).not.toHaveTextContent('BBBUSDT');
    expect(within(screen.getByTestId('fish-new-panel')).queryByRole('button',{name:/加入信号库/})).not.toBeInTheDocument();
    expect(within(screen.getByTestId('fish-old-panel')).queryByRole('button',{name:/加入信号库/})).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(SIGNAL_LIBRARY_STORAGE_KEY)!)).toHaveLength(0);
  });
  it('只列通过核实的交易所，重复币默认关闭；无币安盘面的外所信号仍可评分但不能跳转',async()=>{
    const foreign={...SIGNAL,id:'fish-gate-NEWUSDT-123',symbol:'NEWUSDT',exchange:'gate',binanceSymbol:null};
    localStorage.setItem(FISH_STORAGE_KEY,JSON.stringify([foreign]));
    const jump=vi.fn(async()=>({ok:true as const}));render(control(jump));
    fireEvent.click(screen.getByRole('button',{name:/^渔/}));
    // 【用户要求】2026-10-19 交易所勾选收在淡色图标后
    expect(screen.queryByRole('checkbox',{name:'币安'})).not.toBeInTheDocument();
    // 【用户要求】2026-10-21 捕捞范围 / 查单个币 / 邮件提醒 / 复原收进「⋯」：顶栏不再直接显示
    for(const name of ['捕捞范围','查单个币','邮件提醒','复原'])expect(screen.queryByRole('button',{name})).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'更多'}));fireEvent.click(screen.getByRole('button',{name:'捕捞范围'}));
    expect(screen.getByRole('checkbox',{name:'币安'})).toBeChecked();
    for(const name of ['OKX','Bitget','Gate']){expect(screen.getByRole('checkbox',{name})).not.toBeChecked();fireEvent.click(screen.getByRole('checkbox',{name}));}
    for(const name of ['Bybit','KuCoin 合约','MEXC 合约'])expect(screen.queryByRole('checkbox',{name})).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox',{name:'含重复币'})).not.toBeChecked();
    fireEvent.click(screen.getByRole('checkbox',{name:'含重复币'}));
    fireEvent.click(screen.getByRole('button',{name:'开始捕捞'}));
    await waitFor(()=>expect(mocks.scan).toHaveBeenCalledWith(expect.objectContaining({exchanges:['binance','okx','bitget','gate'],includeDuplicates:true})));
    const library=screen.getByTestId('fish-old-panel');
    expect(within(library).getByText('Gate')).toBeInTheDocument();
    const buttons=within(library).getAllByTitle('盘面只支持币安行情');
    expect(buttons).toHaveLength(2);for(const b of buttons)expect(b).toBeDisabled();
    fireEvent.click(buttons[0]);expect(jump).not.toHaveBeenCalled();
    const row=within(library).getByText('NEWUSDT').closest('.group')!;
    fireEvent.click(within(row as HTMLElement).getByRole('radio',{name:'4 星'}));
    expect(within(row as HTMLElement).queryByRole('button',{name:/加入信号库/})).not.toBeInTheDocument();
    expect(loadFishSignals()[0]).toMatchObject({exchange:'gate',symbol:'NEWUSDT',quality:4});
    expect(JSON.parse(localStorage.getItem(SIGNAL_LIBRARY_STORAGE_KEY)!)).toHaveLength(0);
  });

  it('新鱼重复命中按交易所定位，只更新本家读数并保留本家评分',async()=>{
    const records:TradeSignal[]=[{...SIGNAL,quality:1},{...SIGNAL,id:'fish-okx-AAAUSDT-123',exchange:'okx',binanceSymbol:'AAAUSDT',quality:3},{...SIGNAL,id:'fish-gate-AAAUSDT-123',exchange:'gate',binanceSymbol:'AAAUSDT',quality:5}];
    localStorage.setItem(FISH_STORAGE_KEY,JSON.stringify(records));
    mocks.scan.mockImplementation(async o=>{o.onSignal({...records[2],quality:undefined,fish:{...SIGNAL.fish!,average:.42}});const p={...initialFishProgress(),status:'complete' as const};o.onProgress(p);return p;});
    render(control());fireEvent.click(screen.getByRole('button',{name:/^渔/}));fireEvent.click(screen.getByRole('button',{name:'开始捕捞'}));
    await waitFor(()=>expect(loadFishSignals().filter(s=>s.freshCatch).map(s=>s.exchange)).toEqual(['gate']));
    const saved=loadFishSignals();expect(saved).toHaveLength(4);expect(saved[0]).toMatchObject({quality:1,fish:{average:.35}});expect(saved[1]).toMatchObject({quality:3,fish:{average:.35}});expect(saved[2]).toMatchObject({quality:5,fish:{average:.35}});expect(saved.find(s=>s.freshCatch)).toMatchObject({quality:5,fish:{average:.42}});
  });

  it('【用户要求】2026-10-19 渔界面只显示命中与进度：进度旁不再有明细入口；整次扫描失败时仍写出报错',async()=>{
    const venue=(status:any,extra={})=>({...initialFishProgress(),status,total:10,done:10,...extra});
    mocks.scan.mockImplementation(async o=>{const p={...initialFishProgress(),status:'complete' as const,cutoffMs:123,total:10,done:10,counts:{...initialFishProgress().counts,hit:3},venues:{binance:venue('complete',{counts:{...initialFishProgress().counts,hit:3}}),okx:venue('skipped',{total:0,done:0,skippedReason:'历史成交只保留约 90 天'})}};o.onProgress(p);return p;});
    render(control());fireEvent.click(screen.getByRole('button',{name:/^渔/}));
    fireEvent.click(screen.getByRole('button',{name:'开始捕捞'}));
    await waitFor(()=>expect(screen.getByTestId('fish-status')).toHaveTextContent('捕捞完成·命中 3·10 / 10'));
    expect(screen.queryByRole('button',{name:'捕捞明细'})).not.toBeInTheDocument();
    expect(screen.queryByText('历史成交只保留约 90 天')).not.toBeInTheDocument();
    expect(screen.queryByText(/未达标/)).not.toBeInTheDocument();
    mocks.scan.mockImplementation(async o=>{const p={...initialFishProgress(),status:'aborted' as const,error:'BTC参考K线不完整，整次扫描中止'};o.onProgress(p);return p;});
    fireEvent.click(screen.getByRole('button',{name:'开始捕捞'}));
    await waitFor(()=>expect(screen.getByText('BTC参考K线不完整，整次扫描中止')).toBeInTheDocument());
  });
});

it('默认只币安、不选美股；其他交易所与美股仅明确勾选后传入扫描',async()=>{
 render(control());fireEvent.click(screen.getByRole('button',{name:/^渔/}));fireEvent.click(screen.getByRole('button',{name:'更多'}));fireEvent.click(screen.getByRole('button',{name:'捕捞范围'}));
 expect(screen.getByRole('checkbox',{name:'币安'})).toBeChecked();
 for(const name of ['OKX','Bitget','Gate','美股'])expect(screen.getByRole('checkbox',{name})).not.toBeChecked();
 fireEvent.click(screen.getByRole('button',{name:'开始捕捞'}));await waitFor(()=>expect(mocks.scan).toHaveBeenCalledTimes(1));
 expect(mocks.scan.mock.calls[0][0]).toMatchObject({exchanges:['binance'],includeUsStocks:false});
 await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('捕捞完成'));
 fireEvent.click(screen.getByRole('checkbox',{name:'Bitget'}));fireEvent.click(screen.getByRole('checkbox',{name:'美股'}));expect(mocks.scan).toHaveBeenCalledTimes(1);
 fireEvent.click(screen.getByRole('button',{name:'开始捕捞'}));await waitFor(()=>expect(mocks.scan).toHaveBeenCalledTimes(2));
 expect(mocks.scan.mock.calls[1][0]).toMatchObject({exchanges:['binance','bitget'],includeUsStocks:true});
 await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('捕捞完成'));
 fireEvent.click(screen.getByRole('checkbox',{name:'币安'}));fireEvent.click(screen.getByRole('checkbox',{name:'美股'}));
 fireEvent.click(screen.getByRole('button',{name:'开始捕捞'}));await waitFor(()=>expect(mocks.scan).toHaveBeenCalledTimes(3));
 expect(mocks.scan.mock.calls[2][0]).toMatchObject({exchanges:['bitget'],includeUsStocks:false});
},30000);
// 【用户要求】2026-10-21「自动捕捉模式时，时间默认为现在（除非是手动输入了）」
it('自动模式下打开时间框是「现在」（不恢复以前输过的）；切到自动清空；自动模式里自己输的照用',async()=>{
 sessionStorage.setItem('veil.fish.time','2025-04-23 01:26:00');
 saveFishAuto({mode:'auto',hours:1,lastRunAt:Date.now()});
 render(control());fireEvent.click(screen.getByRole('button',{name:/^渔/}));
 const time=()=>screen.getByLabelText('捕捞时间（UTC+8）') as HTMLInputElement;
 expect(time().value).toBe('');expect(time()).toHaveAttribute('autocomplete','off');
 fireEvent.change(time(),{target:{value:'2026-10-18 12:34:56'}});expect(time().value).toBe('2026-10-18 12:34:56');
 fireEvent.click(screen.getByRole('radio',{name:'手动'}));expect(time().value).toBe('2026-10-18 12:34:56');
 fireEvent.click(screen.getByRole('radio',{name:'自动'}));await waitFor(()=>expect(time().value).toBe(''));
});
it('手动模式下打开照常恢复本次会话输过的时间',()=>{
 sessionStorage.setItem('veil.fish.time','2025-04-23 01:26:00');
 render(control());fireEvent.click(screen.getByRole('button',{name:/^渔/}));
 expect((screen.getByLabelText('捕捞时间（UTC+8）') as HTMLInputElement).value).toBe('2025-04-23 01:26:00');
});

it.each(['新鱼','鱼舱'])('从 %s 跳转到币种后返回，恢复外层位置、列表滚动与原排序',async(title)=>{
 const rows=Array.from({length:80},(_,i)=>({...SIGNAL,id:`nav-${i}`,symbol:`C${String(i).padStart(3,'0')}USDT`,timeMs:i+1,freshCatch:title==='新鱼'}));
 localStorage.setItem(FISH_STORAGE_KEY,JSON.stringify(rows));
 const jump=vi.fn(async()=>({ok:true as const}));render(control(jump));
 const toggle=screen.getByRole('button',{name:/^渔/});fireEvent.click(toggle);
 const section=screen.getByTestId(title==='新鱼'?'fish-new-panel':'fish-old-panel');
 fireEvent.click(within(section).getByTestId('signal-sort-标的'));
 fireEvent.click(within(section).getByTestId('signal-sort-标的'));
 const list=within(section).getByTestId('signal-library-scroller');list.scrollTop=505;fireEvent.scroll(list);
 const panel=screen.getByTestId('fish-panel');panel.scrollTop=320;
 await waitFor(()=>expect(within(list).getByText('C059USDT')).toBeInTheDocument());
 const visible=within(list).getByText('C059USDT');fireEvent.click(visible);
 await waitFor(()=>expect(screen.queryByTestId('fish-panel')).toBeNull());
 expect(jump).toHaveBeenCalledWith('C059USDT',60);
 fireEvent.click(toggle);
 const restored=screen.getByTestId(title==='新鱼'?'fish-new-panel':'fish-old-panel');
 expect(within(restored).getByTestId('signal-sort-标的')).toHaveAttribute('aria-sort','descending');
 expect(within(restored).getByTestId('signal-library-scroller').scrollTop).toBe(505);
 expect(screen.getByTestId('fish-panel').scrollTop).toBe(320);
});

it('鱼舱把截图中的三轮相同行合成一条，徽标/月计数一致，评分后刷新和删除都只操作这一条',async()=>{
 const rows=[100,200,300].map((caughtAt,i)=>archiveFishForNextRound([{...SIGNAL,caughtAt,quality:i===0?4:undefined}],caughtAt+10)[0]);
 localStorage.setItem(FISH_STORAGE_KEY,JSON.stringify(rows));
 const view=render(control());
 fireEvent.click(screen.getByRole('button',{name:/^渔/}));
 const cabin=screen.getByTestId('fish-old');
 expect(within(cabin).getAllByText('AAAUSDT')).toHaveLength(1);
 expect(within(cabin).getByRole('button',{name:/^鱼舱/})).toHaveTextContent('1');
 expect(within(cabin).getByLabelText('鱼舱的月份')).toHaveDisplayValue('全部月份（1）');
 expect(screen.getByRole('button',{name:/^渔/})).toHaveTextContent('1');
 fireEvent.click(within(cabin).getByRole('radio',{name:'5 星'}));
 expect(loadFishSignals()).toHaveLength(1);expect(loadFishSignals()[0].quality).toBe(5);
 view.unmount();render(control());
 fireEvent.click(screen.getByRole('button',{name:/^渔/}));
 const restored=screen.getByTestId('fish-old');
 expect(within(restored).getAllByText('AAAUSDT')).toHaveLength(1);
 expect(within(restored).getByRole('radio',{name:'5 星'})).toBeChecked();
 fireEvent.click(within(restored).getByTitle('删除该信号'));
 fireEvent.click(within(restored).getByRole('button',{name:/^确认删除/}));
 expect(loadFishSignals()).toHaveLength(0);
},30000);
