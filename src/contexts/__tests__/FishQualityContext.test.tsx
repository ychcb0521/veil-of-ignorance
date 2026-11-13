import {useState} from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FishQualityProvider, usePageFishQuality } from '@/contexts/FishQualityContext';
import { importQualityFish, newQualityStudy, qualityDisplayRows, qualityResultKey, qualityRunSamples, type QualityRunOptions } from '@/lib/fish/quality';
import { makeQualityBuyFilter } from '@/lib/fish/qualityFilters';
import { BSS_DEF, definitionKey } from '@/lib/deepDig/features';

const storage = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), screening: vi.fn() }));
vi.mock('@/lib/fish/qualityStore', () => ({ loadQualityStudy: storage.load, saveQualityStudy: storage.save }));
vi.mock('@/lib/fish/preEntryMonitorV6Store',()=>({loadPreEntryLibraryV6:storage.screening, loadPreEntryWorkspaceDraft:async()=>undefined, savePreEntryLibraryV6:async()=>{}, savePreEntryWorkspaceDraft:async()=>{}}));
vi.mock('@/lib/fish/preEntryMonitorV5Store',()=>({loadPreEntryLibraryV5:async()=>({version:1,rounds:[],records:[]})}));
vi.mock('@/lib/fish/preEntryMonitorV4Store',()=>({loadPreEntryLibraryV4:async()=>({version:1,rounds:[],records:[]})}));
vi.mock('@/lib/fish/preEntryMonitorV3Store',()=>({loadPreEntryLibraryV3:async()=>({version:1,rounds:[],records:[]})}));
vi.mock('@/lib/fish/preEntryMonitorV2Store',()=>({loadPreEntryLibraryV2:async()=>({version:1,rounds:[],records:[]})}));
vi.mock('@/lib/fish/preEntryMonitorStore',()=>({loadPreEntryLibrary:async()=>({version:1,rounds:[],records:[]})}));
const T = Date.UTC(2026, 9, 20), EMPTY = [];
const fish = [{ id: 'a', symbol: 'AAAUSDT', timeMs: T, timeLabel: '', fallbackZone: '', fish: { featureId: 'bss', featureShort: 'BSS', definitionKey: definitionKey(BSS_DEF), statistic: '结果', cutoffMs: T, threshold: .12, average: .2, cbi2: .2, startAverage: .2, previousAverage: .1, direction: '>' as const, scale: 1 } }];
function Controls() {
  const q = usePageFishQuality(fish, EMPTY), navigate = useNavigate();
  return <><button disabled={!q.preEntry?.ready} onClick={()=>{const f=makeQualityBuyFilter('state:state','>',.8);q.setSelectedRows(qualityDisplayRows(q.study).map(r=>r.id));q.preEntry!.configure([{id:'frozen-entry',label:'状态S准入',metric:f.metric,snapshot:f.snapshot,rule:{metric:f.metric,direction:f.direction,threshold:f.threshold}}],12);void q.preEntry!.start(12);}}>开始动态筛选</button><span>{q.preEntry?.library.records[0]?.status}</span><button onClick={() => { q.setSelectedRows(qualityDisplayRows(q.study).map(r => r.id)); void q.start(); }}>更新收益</button><button onClick={() => { q.setSelectedRows(qualityDisplayRows(q.study).map(r => r.id)); q.setFilters([makeQualityBuyFilter('state:state', '>', .7)]); void q.startFilter(); }}>开始过滤</button><button onClick={() => navigate('/other')}>其他页面</button><button onClick={q.cancel}>暂停监测</button><span>结果 {q.study.results.length}</span><span>{q.running ? '运行中' : '已结束'}</span></>;
}
function Other() { const navigate = useNavigate(); return <button onClick={() => navigate('/')}>返回</button>; }
beforeEach(() => { vi.useFakeTimers(); storage.load.mockReset().mockResolvedValue({ study: { ...importQualityFish(newQualityStudy(T), fish), workspaceUpdatedAt: T } }); storage.save.mockReset().mockResolvedValue(true); storage.screening.mockReset().mockResolvedValue({ version: 1, rounds: [], records: [] }); });
afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); });
const flush = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
it('does not load or save the research archive during a campaign-only visit, then activates once on demand', async () => {
  render(<MemoryRouter initialEntries={['/other']}><FishQualityProvider owner="a" run={vi.fn(async () => {})}><Routes><Route path="/" element={<Controls/>}/><Route path="/other" element={<Other/>}/></Routes></FishQualityProvider></MemoryRouter>);
  await flush(20_000);
  expect(storage.load).not.toHaveBeenCalled(); expect(storage.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '返回' })); await flush();
  expect(storage.load).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: '其他页面' })); await flush();
  fireEvent.click(screen.getByRole('button', { name: '返回' })); await flush();
  expect(storage.load).toHaveBeenCalledTimes(1);
});
it('defers research archives on a collapsed home page until the fish panel opens', async () => {
  function Home() {
    const [open, setOpen] = useState(false);
    usePageFishQuality(fish, EMPTY, EMPTY, open);
    return <button onClick={() => setOpen(value => !value)}>渔</button>;
  }
  render(<MemoryRouter><FishQualityProvider owner="a" run={vi.fn(async () => {})}><Home/></FishQualityProvider></MemoryRouter>);
  await flush(20_000);
  expect(storage.load).not.toHaveBeenCalled();
  expect(storage.screening).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '渔' }));
  await flush();
  expect(storage.load).toHaveBeenCalledTimes(1);
  expect(storage.screening).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: '渔' }));
  fireEvent.click(screen.getByRole('button', { name: '渔' }));
  await flush();
  expect(storage.load).toHaveBeenCalledTimes(1);
  expect(storage.screening).toHaveBeenCalledTimes(1);
});
it('keeps evaluating and persisting through route unmounts and restores live progress on return', async () => {
  let task!: QualityRunOptions, finish!: () => void;
  const run = vi.fn(async (o: QualityRunOptions) => { task = o; await new Promise<void>(resolve => { finish = resolve; }); });
  render(<MemoryRouter><FishQualityProvider owner="a" run={run}><Routes><Route path="/" element={<Controls/>}/><Route path="/other" element={<Other/>}/></Routes></FishQualityProvider></MemoryRouter>);
  await flush(); fireEvent.click(screen.getByRole('button', { name: '更新收益' })); await flush();
  fireEvent.click(screen.getByRole('button', { name: '其他页面' })); await flush();
  expect(task.signal.aborted).toBe(false); expect(screen.getByRole('status')).toHaveTextContent('收益后台更新中');
  const row = qualityRunSamples(task.study)[0], plan = task.study.sellPlans![0];
  act(() => { task.onProgress({ done: 1, total: 2, current: 'AAAUSDT' }); task.onResult({ key: qualityResultKey(row, plan, 0), sampleId: row.id, groupId: plan.id, evaluatedAt: T, status: 'open', entryTime: T, entryPrice: 100, returnPct: 1 }); });
  await flush(500); expect(storage.save).toHaveBeenLastCalledWith('a', expect.objectContaining({ results: expect.arrayContaining([expect.objectContaining({ sampleId: row.id })]) }));
  expect(screen.getByRole('status')).toHaveTextContent('1/2');
  fireEvent.click(screen.getByRole('button', { name: '返回' })); await flush();
  expect(screen.getByText('结果 1')).toBeInTheDocument(); expect(screen.getByText('运行中')).toBeInTheDocument(); expect(run).toHaveBeenCalledTimes(1);
  finish(); await flush(); expect(screen.getByText('已结束')).toBeInTheDocument();
});

it('keeps both independent tasks alive across navigation and reports their separate progress', async () => {
  const tasks: QualityRunOptions[] = [], releases: (() => void)[] = [];
  const run = vi.fn(async (o: QualityRunOptions) => { tasks.push(o); await new Promise<void>(resolve => releases.push(resolve)); });
  render(<MemoryRouter><FishQualityProvider owner="a" run={run}><Routes><Route path="/" element={<Controls/>}/><Route path="/other" element={<Other/>}/></Routes></FishQualityProvider></MemoryRouter>);
  await flush(); fireEvent.click(screen.getByRole('button', { name: '开始过滤' })); fireEvent.click(screen.getByRole('button', { name: '更新收益' })); await flush();
  const filter = tasks.find(t => t.task === 'filter')!, monitor = tasks.find(t => t.task === 'monitor')!;
  expect(tasks).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: '其他页面' })); await flush();
  act(() => { filter.onProgress({ done: 1, total: 2, current: '' }); monitor.onProgress({ done: 0, total: 2, current: '' }); });
  expect(filter.signal.aborted).toBe(false); expect(monitor.signal.aborted).toBe(false);
  expect(screen.getByRole('status')).toHaveTextContent('过滤后台运行中 · 1/2'); expect(screen.getByRole('status')).toHaveTextContent('收益后台更新中 · 0/2');
  releases[0](); await flush();
  expect(screen.getByRole('status')).not.toHaveTextContent('过滤后台运行中'); expect(screen.getByRole('status')).toHaveTextContent('收益后台更新中');
  expect(monitor.signal.aborted).toBe(false); releases[1](); await flush();
  expect(screen.queryByRole('status')).toBeNull();
});

// 【用户要求】2026-11-01「点进战役后持仓监测停了」：离开页面不暂停；真正暂停时写下原因（监测库那一轮的 error）
const lastRound = () => { const saved = storage.save.mock.calls.at(-1)![1] as { workspaceMonitorDraft?: { rounds: { state: string; error?: string; startedAt: number }[] } }; return [...(saved.workspaceMonitorDraft?.rounds ?? [])].sort((a, b) => a.startedAt - b.startedAt).at(-1); };
it('does not pause on leaving the page, and records why a round was paused', async () => {
  let task!: QualityRunOptions;
  const run = vi.fn(async (o: QualityRunOptions) => { task = o; await new Promise<void>((_, reject) => o.signal.addEventListener('abort', () => reject(new DOMException('已暂停', 'AbortError')))); });
  const view = render(<MemoryRouter><FishQualityProvider owner="a" run={run}><Routes><Route path="/" element={<Controls/>}/><Route path="/other" element={<Other/>}/></Routes></FishQualityProvider></MemoryRouter>);
  await flush(); fireEvent.click(screen.getByRole('button', { name: '更新收益' })); await flush();
  fireEvent.click(screen.getByRole('button', { name: '其他页面' })); await flush(1000);
  expect(task.signal.aborted).toBe(false); expect(lastRound()?.state).toBe('running');
  fireEvent.click(screen.getByRole('button', { name: '返回' })); await flush();
  fireEvent.click(screen.getByRole('button', { name: '暂停监测' })); await flush(1000);
  expect(task.signal.aborted).toBe(true); expect(lastRound()).toMatchObject({ state: 'paused', error: '手动点了「暂停监测」' });
  fireEvent.click(screen.getByRole('button', { name: '更新收益' })); await flush();
  view.unmount(); await flush(1000);
  expect(lastRound()).toMatchObject({ state: 'paused', error: expect.stringContaining('页面关闭') });
});

it('keeps dynamic screening and its frozen conditions alive while another task runs and routes change',async()=>{
 const tasks:QualityRunOptions[]=[],releases:(()=>void)[]=[];
 const run=vi.fn(async(o:QualityRunOptions)=>{tasks.push(o);await new Promise<void>(resolve=>releases.push(resolve));});
 render(<MemoryRouter><FishQualityProvider owner="a" run={run}><Routes><Route path="/" element={<Controls/>}/><Route path="/other" element={<Other/>}/></Routes></FishQualityProvider></MemoryRouter>);await flush();
 fireEvent.click(screen.getByRole('button',{name:'开始动态筛选'}));await flush();const screening=tasks.find(t=>t.task==='pre-entry')!;expect(screening).toBeDefined();
 fireEvent.click(screen.getByRole('button',{name:'更新收益'}));await flush();expect(tasks.some(t=>t.task==='monitor')).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'其他页面'}));await flush();expect(screening.signal.aborted).toBe(false);expect(screening.preEntry!.round.plans![0].rule!.threshold).toBe(.8);
 act(()=>{screening.onProgress({done:1,total:1,current:''});screening.preEntry!.onRecord({...screening.preEntry!.records[0],status:'matched',matchedAt:T+60000,updatedAt:T+60000});});await flush();expect(screen.getByRole('status')).toHaveTextContent('买前筛选后台运行中 · 1/1');
 fireEvent.click(screen.getByRole('button',{name:'返回'}));await flush();expect(screen.getByText('matched')).toBeInTheDocument();expect(screening.signal.aborted).toBe(false);expect(tasks.filter(t=>t.task==='pre-entry')).toHaveLength(1);
 releases.forEach(resolve=>resolve());await flush();
});

it('continues dynamic screening while the trading panel is closed for chart operations',async()=>{
 let task!:QualityRunOptions,finish!:()=>void;const run=vi.fn(async(options:QualityRunOptions)=>{task=options;await new Promise<void>(resolve=>finish=resolve);});
 function ChartView(){const [panel,setPanel]=useState(true);return panel?<><Controls/><button onClick={()=>setPanel(false)}>查看盘面</button></>:<button onClick={()=>setPanel(true)}>返回组合表</button>;}
 render(<MemoryRouter><FishQualityProvider owner="a" run={run}><ChartView/></FishQualityProvider></MemoryRouter>);await flush();fireEvent.click(screen.getByRole('button',{name:'开始动态筛选'}));await flush();fireEvent.click(screen.getByRole('button',{name:'查看盘面'}));await flush();expect(task.signal.aborted).toBe(false);
 act(()=>{task.preEntry!.onRecord({...task.preEntry!.records[0],status:'matched',matchedAt:T+60000,updatedAt:T+60000});task.onProgress({done:1,total:1,current:''});});await flush(500);expect(task.signal.aborted).toBe(false);fireEvent.click(screen.getByRole('button',{name:'返回组合表'}));await flush();expect(screen.getByText('matched')).toBeInTheDocument();expect(run).toHaveBeenCalledOnce();finish();await flush();
});
