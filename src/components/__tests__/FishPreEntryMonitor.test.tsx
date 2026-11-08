import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { FishPreEntryMonitor } from '../FishPreEntryMonitor';
import { TooltipProvider } from '../ui/tooltip';
import { emptyPreEntryLibrary, PRE_ENTRY_INTRABAR_VERSION, PRE_ENTRY_ZERO_TRADE_VERSION, type PreEntryRecord } from '@/lib/fish/preEntryMonitor';
import type { FishQualityState } from '@/hooks/useFishQuality';
import { qualitySplitPrimaryAction, qualitySplitPauseAction } from '../FishQualityModule';
import { emptyPreEntryThreeStage, PRE_ENTRY_THREE_STAGE_V5, PRE_ENTRY_THREE_STAGE_VERSION } from '@/lib/fish/preEntryThreeStage';

afterEach(cleanup);
it('renders a v5 admission with guard evidence even when no extra primary indicator is required',()=>{
  const time=Date.UTC(2026,2,29,5),config=emptyPreEntryThreeStage();
  const record:PreEntryRecord={id:'v5',roundId:'r',planId:'p',status:'matched',startTime:time,cursor:time+300000,matchedAt:time+300000,updatedAt:1,readings:[],detail:'三阶同刻通过',sample:{id:'sample',source:{id:'source',symbol:'TESTUSDT',timeMs:time,timeLabel:'',fallbackZone:''},groups:[],enteredAt:time,basis:'signal',importedAt:time},
    threeStage:{at:time+300000,state:'matched',first:{status:'pass'},second:{status:'pass'},third:{status:'pass'},readings:[],event:{id:'native-event',at:time+300000,kind:'lower',price:90,regime:'range',previousPrice:95,previousRegime:'trend',boxId:'box',segment:0,broken:false,tickSize:'1',algorithmVersion:'dbl-5-v2',guardVersion:'dbl5-guard-v1',parameters:{n:3},initializationStart:time-300000,initializationId:'fixture',dataChecksum:'sum'}}};
  const state={ready:true,preEntry:{ready:true,running:false,error:'',library:{...emptyPreEntryLibrary(),records:[record],rounds:[{id:'r',engine:PRE_ENTRY_THREE_STAGE_V5,plans:[{id:'p',label:'三阶',metric:'raw',snapshot:{},preEntryThreeStage:config}],state:'complete',filters:[],hours:0,startedAt:1,updatedAt:1}]}}} as unknown as FishQualityState;
  render(<TooltipProvider><FishPreEntryMonitor state={state} selectedCount={1} filtersOn onSelected={vi.fn()}/></TooltipProvider>);
  fireEvent.click(screen.getByLabelText('打开筛选库'));
  if(screen.queryByLabelText('打开筛选归档 r')){fireEvent.click(screen.getByLabelText('打开筛选归档 r'));fireEvent.click(screen.getByText('入选判定详情'));}
  const dialog=screen.getByRole('dialog');
  expect(within(dialog).getByText('分钟筛选 v5 · 三阶准入')).toBeInTheDocument();
  fireEvent.click(within(dialog).getByText('三阶判定证据'));
  expect(within(dialog).getByText(/价格下移 · 90 · 虚线/)).toBeInTheDocument();
  expect(within(dialog).getByText(/native-event/)).toBeInTheDocument();
});
it('keeps scan controls compact and offers data retries inside the action menu', () => {
  const resume = vi.fn(), time = Date.UTC(2026, 2, 29, 5);
  const records: PreEntryRecord[] = ['matched','error','unmatched'].map((status, i) => ({
    id: String(i), roundId: 'r', status: status as PreEntryRecord['status'], startTime: time, cursor: time,
    updatedAt: i, readings: [], sample: { source: { symbol: String(i), timeMs: time } } as PreEntryRecord['sample'],
  }));
  const state = { ready: true, preEntry: { library: { ...emptyPreEntryLibrary(), records,
    rounds: [{ id: 'r', engine: PRE_ENTRY_ZERO_TRADE_VERSION, state: 'complete', filters: [], hours: 0, startedAt: 1, updatedAt: 1 }] },
    ready: true, running: false, progress: { done: 1, total: 3 }, error: '', resume } } as unknown as FishQualityState;
  render(<TooltipProvider><FishPreEntryMonitor state={state} selectedCount={0} filtersOn onSelected={vi.fn()}/></TooltipProvider>);
  expect(screen.getByRole('status')).toHaveTextContent('已完成');
  expect(screen.getByRole('status')).toHaveTextContent('3 / 3');
  expect(screen.queryByLabelText('打开筛选记录')).not.toBeInTheDocument();
  expect(screen.queryByText(/本轮沿用/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('开始筛选的其他方式'));
  fireEvent.click(screen.getByText('重试本轮缺数据（1）'));
  expect(resume).toHaveBeenCalledWith('r');
});

it('shows only admitted records and preserves all underlying scan records', async () => {
  const time=Date.UTC(2026,2,29,5), statuses=['matched','unmatched','warming','error','paused','queued','scanning'] as const;
  const records:PreEntryRecord[]=statuses.map((status,i)=>({id:status,roundId:'r',status,startTime:time,cursor:time,matchedAt:status==='matched'?time+60000:undefined,updatedAt:i,readings:[],detail:status==='error'?'真实行情缺口':undefined,
    sample:{id:status,source:{id:status,symbol:`TURING:TURING ${i+1}`,timeMs:time,timeLabel:'',fallbackZone:''},groups:[],enteredAt:time,basis:'signal',importedAt:time}}));
  const state={ready:true,selectPreEntryRecords:vi.fn(()=>1),preEntry:{library:{...emptyPreEntryLibrary(),records,rounds:[{id:'r',engine:PRE_ENTRY_ZERO_TRADE_VERSION,state:'paused',filters:[],hours:0,startedAt:1,updatedAt:1}]},ready:true,running:false,error:'',progress:null,start:vi.fn(),resume:vi.fn(),restart:vi.fn()}} as unknown as FishQualityState;
  render(<TooltipProvider><FishPreEntryMonitor state={state} selectedCount={1} filtersOn onSelected={vi.fn()}/></TooltipProvider>);
  fireEvent.click(screen.getByLabelText('打开筛选库'));
  if(screen.queryByLabelText('打开筛选归档 r')){fireEvent.click(screen.getByLabelText('打开筛选归档 r'));fireEvent.click(screen.getByText('入选判定详情'));}
  const admitted=screen.getByRole('dialog');
  expect(within(admitted).getAllByTestId('pre-entry-library-row')).toHaveLength(1);
  expect(within(admitted).getByText('TURING:TURING 1')).toBeInTheDocument();
  expect(within(admitted).queryByText('缺数据')).not.toBeInTheDocument();
  fireEvent.click(within(admitted).getByLabelText('全选当前筛选的筛选库记录'));
  fireEvent.click(within(admitted).getByText('在组合表中勾选'));
  expect(state.selectPreEntryRecords).toHaveBeenCalledWith(['matched']);
  await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.queryByLabelText('打开筛选记录')).not.toBeInTheDocument();
  expect(records).toHaveLength(7);
});

it('offers an explicit new round for an old failed scan instead of silently changing its rules', () => {
  const restart=vi.fn(), time=Date.UTC(2026,2,29,5);
  const state={ready:true,preEntry:{library:{...emptyPreEntryLibrary(),rounds:[{id:'old',engine:PRE_ENTRY_INTRABAR_VERSION,state:'paused',filters:[],hours:0,startedAt:1,updatedAt:1}],records:[{id:'error',roundId:'old',status:'error',startTime:time,cursor:time,updatedAt:1,readings:[],sample:{source:{symbol:'TURING:TURING 50',timeMs:time}}}]},ready:true,running:false,error:'',progress:null,restart,resume:vi.fn()}} as unknown as FishQualityState;
  render(<TooltipProvider><FishPreEntryMonitor state={state} selectedCount={1} filtersOn onSelected={vi.fn()}/></TooltipProvider>);
  expect(screen.queryByText(/本轮沿用/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('开始筛选的其他方式'));
  fireEvent.click(screen.getByText('从头重新筛选'));
  expect(restart).toHaveBeenCalledWith(0); expect(state.preEntry!.resume).not.toHaveBeenCalled();
});
it('orders start, conditions and selected library like holding monitoring, with duration inside settings', async () => {
  const start = vi.fn(), pause = vi.fn();
  const state = { ready: true, preEntry: { library: {...emptyPreEntryLibrary(),settings:{updatedAt:1,hours:48,plans:[]}}, ready: true, running: false, error: '', progress: null, start, pause, resume: vi.fn(), retry: vi.fn() } } as unknown as FishQualityState;
  const view = render(<TooltipProvider><FishPreEntryMonitor state={state} selectedCount={2} filtersOn onSelected={vi.fn()} renderConditions={done => <button onClick={done}>保存条件</button>}/></TooltipProvider>);
  expect(within(screen.getByTestId('pre-entry-controls')).getAllByRole('button').map(b => b.getAttribute('aria-label') ?? b.textContent)).toEqual(['开始筛选', '开始筛选的其他方式', '动态筛选条件', '打开筛选库', '查看本轮筛选结果']);
  expect(screen.getByText('开始筛选').className).toBe(qualitySplitPrimaryAction);
  expect(screen.queryByLabelText('筛选时长（小时）')).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('动态筛选条件'));
  fireEvent.click(screen.getByText('保存条件'));
  fireEvent.click(screen.getByText('开始筛选'));
  expect(start).toHaveBeenCalledWith(48);
  fireEvent.click(screen.getByLabelText('打开筛选库'));
  if(screen.queryByLabelText('打开筛选归档 r')){fireEvent.click(screen.getByLabelText('打开筛选归档 r'));fireEvent.click(screen.getByText('入选判定详情'));}
  await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
  expect(screen.getByText('暂无入选记录。满足全部条件后才会进入筛选库。')).toBeInTheDocument();
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
it('renders the reordered v6 evidence as ⓪ 必要条件 → ① 防守线 → ② 排除门槛',()=>{
  const time=Date.UTC(2026,2,29,5),config=emptyPreEntryThreeStage();
  const record:PreEntryRecord={id:'v6',roundId:'r',planId:'p',status:'matched',startTime:time,cursor:time+300000,matchedAt:time+300000,updatedAt:1,readings:[],detail:'三阶同刻通过',sample:{id:'sample',source:{id:'source',symbol:'TESTUSDT',timeMs:time,timeLabel:'',fallbackZone:''},groups:[],enteredAt:time,basis:'signal',importedAt:time},
    threeStage:{at:time+300000,state:'matched',zero:{status:'pass'},first:{status:'pass'},second:{status:'pass'},readings:[],event:{id:'native-event',at:time+300000,kind:'lower',price:90,regime:'range',previousPrice:95,previousRegime:'trend',boxId:'box',segment:0,broken:false,tickSize:'1',algorithmVersion:'dbl-5-v2',guardVersion:'dbl5-guard-v1',parameters:{n:3},initializationStart:time-300000,initializationId:'fixture',dataChecksum:'sum'}}};
  const state={ready:true,preEntry:{ready:true,running:false,error:'',library:{...emptyPreEntryLibrary(),records:[record],rounds:[{id:'r',engine:PRE_ENTRY_THREE_STAGE_VERSION,plans:[{id:'p',label:'三阶',metric:'raw',snapshot:{},preEntryThreeStage:config}],state:'complete',filters:[],hours:0,startedAt:1,updatedAt:1}]}}} as unknown as FishQualityState;
  render(<TooltipProvider><FishPreEntryMonitor state={state} selectedCount={1} filtersOn onSelected={vi.fn()}/></TooltipProvider>);
  fireEvent.click(screen.getByLabelText('打开筛选库'));
  if(screen.queryByLabelText('打开筛选归档 r'))fireEvent.click(screen.getByLabelText('打开筛选归档 r'));
  const dialog=screen.getByRole('dialog');
  expect(within(dialog).getByText('分钟筛选 v6 · 三阶准入（⓪必要条件 → ①防守线 → ②排除）')).toBeInTheDocument();
  fireEvent.click(within(dialog).getByText('入选判定详情'));
  expect(within(dialog).getByText(/⓪ 必要条件：通过/)).toBeInTheDocument();
  expect(within(dialog).getByText(/② 排除门槛：通过/)).toBeInTheDocument();
});
