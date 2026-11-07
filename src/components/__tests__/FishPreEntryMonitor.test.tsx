import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { FishPreEntryMonitor } from '../FishPreEntryMonitor';
import { TooltipProvider } from '../ui/tooltip';
import { emptyPreEntryLibrary, PRE_ENTRY_INTRABAR_VERSION, PRE_ENTRY_ZERO_TRADE_VERSION, type PreEntryRecord } from '@/lib/fish/preEntryMonitor';
import type { FishQualityState } from '@/hooks/useFishQuality';
import { qualitySplitPrimaryAction, qualitySplitPauseAction } from '../FishQualityModule';

afterEach(cleanup);
it('shows completed attempts and data errors instead of a stale progress count, and offers retry', () => {
  const resume = vi.fn(), time = Date.UTC(2026, 2, 29, 5);
  const records: PreEntryRecord[] = ['matched','error','unmatched'].map((status, i) => ({
    id: String(i), roundId: 'r', status: status as PreEntryRecord['status'], startTime: time, cursor: time,
    updatedAt: i, readings: [], sample: { source: { symbol: String(i), timeMs: time } } as PreEntryRecord['sample'],
  }));
  const state = { ready: true, preEntry: { library: { ...emptyPreEntryLibrary(), records,
    rounds: [{ id: 'r', engine: PRE_ENTRY_ZERO_TRADE_VERSION, state: 'complete', filters: [], hours: 0, startedAt: 1, updatedAt: 1 }] },
    ready: true, running: false, progress: { done: 1, total: 3 }, error: '', resume } } as unknown as FishQualityState;
  render(<TooltipProvider><FishPreEntryMonitor state={state} selectedCount={0} filtersOn onSelected={vi.fn()}/></TooltipProvider>);
  expect(screen.getByRole('status')).toHaveTextContent('筛选完成 3/3');
  expect(screen.getByRole('status')).toHaveTextContent('已满足 1 · 缺数据 1');
  fireEvent.click(screen.getByText('重试缺数据记录'));
  expect(resume).toHaveBeenCalledWith('r');
});

it('admits only matched records and keeps errors and pending work in separate scan records', async () => {
  const time=Date.UTC(2026,2,29,5), statuses=['matched','unmatched','warming','error','paused','queued','scanning'] as const;
  const records:PreEntryRecord[]=statuses.map((status,i)=>({id:status,roundId:'r',status,startTime:time,cursor:time,matchedAt:status==='matched'?time+60000:undefined,updatedAt:i,readings:[],detail:status==='error'?'真实行情缺口':undefined,
    sample:{id:status,source:{id:status,symbol:`TURING:TURING ${i+1}`,timeMs:time,timeLabel:'',fallbackZone:''},groups:[],enteredAt:time,basis:'signal',importedAt:time}}));
  const state={ready:true,selectPreEntryRecords:vi.fn(()=>1),preEntry:{library:{...emptyPreEntryLibrary(),records,rounds:[{id:'r',engine:PRE_ENTRY_ZERO_TRADE_VERSION,state:'paused',filters:[],hours:0,startedAt:1,updatedAt:1}]},ready:true,running:false,error:'',progress:null,start:vi.fn(),resume:vi.fn(),restart:vi.fn()}} as unknown as FishQualityState;
  render(<TooltipProvider><FishPreEntryMonitor state={state} selectedCount={1} filtersOn onSelected={vi.fn()}/></TooltipProvider>);
  fireEvent.click(screen.getByLabelText('打开入选库'));
  const admitted=screen.getByRole('dialog');
  expect(within(admitted).getAllByTestId('pre-entry-library-row')).toHaveLength(1);
  expect(within(admitted).getByText('TURING:TURING 1')).toBeInTheDocument();
  expect(within(admitted).queryByText('缺数据')).not.toBeInTheDocument();
  fireEvent.click(within(admitted).getByLabelText('全选当前筛选的入选库记录'));
  fireEvent.click(within(admitted).getByText('在组合表中勾选'));
  expect(state.selectPreEntryRecords).toHaveBeenCalledWith(['matched']);
  await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  fireEvent.click(screen.getByLabelText('打开筛选记录'));
  const audit=screen.getByRole('dialog');
  expect(within(audit).getAllByTestId('pre-entry-scan-row')).toHaveLength(7);
  expect(within(audit).getByText('真实行情缺口')).toBeInTheDocument();
  expect(within(audit).queryByText('在组合表中勾选')).not.toBeInTheDocument();
  expect(records).toHaveLength(7);
});

it('offers an explicit new round for an old failed scan instead of silently changing its rules', () => {
  const restart=vi.fn(), time=Date.UTC(2026,2,29,5);
  const state={ready:true,preEntry:{library:{...emptyPreEntryLibrary(),rounds:[{id:'old',engine:PRE_ENTRY_INTRABAR_VERSION,state:'paused',filters:[],hours:0,startedAt:1,updatedAt:1}],records:[{id:'error',roundId:'old',status:'error',startTime:time,cursor:time,updatedAt:1,readings:[],sample:{source:{symbol:'TURING:TURING 50',timeMs:time}}}]},ready:true,running:false,error:'',progress:null,restart,resume:vi.fn()}} as unknown as FishQualityState;
  render(<TooltipProvider><FishPreEntryMonitor state={state} selectedCount={1} filtersOn onSelected={vi.fn()}/></TooltipProvider>);
  fireEvent.click(screen.getByText('保留旧轮次，用新版重新筛选'));
  expect(restart).toHaveBeenCalledWith(0); expect(state.preEntry!.resume).not.toHaveBeenCalled();
});
it('orders start, conditions and selected library like holding monitoring, with duration inside settings', async () => {
  const start = vi.fn(), pause = vi.fn();
  const state = { ready: true, preEntry: { library: {...emptyPreEntryLibrary(),settings:{updatedAt:1,hours:48,plans:[]}}, ready: true, running: false, error: '', progress: null, start, pause, resume: vi.fn(), retry: vi.fn() } } as unknown as FishQualityState;
  const view = render(<TooltipProvider><FishPreEntryMonitor state={state} selectedCount={2} filtersOn onSelected={vi.fn()} renderConditions={done => <button onClick={done}>保存条件</button>}/></TooltipProvider>);
  expect(within(screen.getByTestId('pre-entry-controls')).getAllByRole('button').map(b => b.getAttribute('aria-label') ?? b.textContent)).toEqual(['开始筛选', '开始筛选的其他方式', '动态筛选条件', '打开入选库']);
  expect(screen.getByText('开始筛选').className).toBe(qualitySplitPrimaryAction);
  expect(screen.queryByLabelText('筛选时长（小时）')).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('动态筛选条件'));
  fireEvent.click(screen.getByText('保存条件'));
  fireEvent.click(screen.getByText('开始筛选'));
  expect(start).toHaveBeenCalledWith(48);
  fireEvent.click(screen.getByLabelText('打开入选库'));
  await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
  expect(screen.getByText('暂无入选记录。满足全部条件后才会进入入选库。')).toBeInTheDocument();
  view.unmount();
  render(<TooltipProvider><FishPreEntryMonitor state={{ ...state, preEntry: { ...state.preEntry!, running: true } }} selectedCount={2} filtersOn onSelected={vi.fn()}/></TooltipProvider>);
  expect(screen.getByText('暂停筛选').className).toBe(qualitySplitPauseAction);
  fireEvent.click(screen.getByText('暂停筛选'));
  expect(pause).toHaveBeenCalledOnce();
});

it('continues a frozen paused round from the main action and exposes restart in the split menu', () => {
  const resume = vi.fn(), restart = vi.fn(), start = vi.fn();
  const library = { ...emptyPreEntryLibrary(), rounds: [{ id: 'paused', startedAt: 1, updatedAt: 1, filters: [], hours: 12, state: 'paused' as const }] };
  const state = { ready: true, preEntry: { library, ready: true, running: false, error: '', progress: null, start, resume, restart } } as unknown as FishQualityState;
  render(<TooltipProvider><FishPreEntryMonitor state={state} selectedCount={2} filtersOn onSelected={vi.fn()}/></TooltipProvider>);
  fireEvent.click(screen.getByText('开始筛选'));
  expect(resume).toHaveBeenCalledWith('paused'); expect(start).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText('开始筛选的其他方式'));
  fireEvent.click(screen.getByText('从头重新筛选'));
  expect(restart).toHaveBeenCalledWith(0);
});

it('does not resume an older paused round after a newer restart has completed', () => {
  const start = vi.fn(), resume = vi.fn();
  const library = { ...emptyPreEntryLibrary(), rounds: [
    { id: 'old', startedAt: 1, updatedAt: 1, filters: [], hours: 12, state: 'paused' as const },
    { id: 'new', startedAt: 2, updatedAt: 3, filters: [], hours: 24, state: 'complete' as const },
  ] };
  const state = { ready: true, preEntry: { library, ready: true, running: false, error: '', progress: null, start, resume } } as unknown as FishQualityState;
  render(<TooltipProvider><FishPreEntryMonitor state={state} selectedCount={2} filtersOn onSelected={vi.fn()}/></TooltipProvider>);
  fireEvent.click(screen.getByText('开始筛选'));
  expect(start).toHaveBeenCalledWith(0); expect(resume).not.toHaveBeenCalled();
});
