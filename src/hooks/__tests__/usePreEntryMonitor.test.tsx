import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PRE_ENTRY_CONDITIONS_VERSION } from '@/lib/fish/preEntryConditions';
import { usePreEntryMonitor } from '../usePreEntryMonitor';
import { emptyPreEntryLibrary, PRE_ENTRY_INTRABAR_VERSION, PRE_ENTRY_ZERO_TRADE_VERSION } from '@/lib/fish/preEntryMonitor';
import { importQualityLibrary, newQualityStudy, qualityComparisonRows, type QualityRunOptions } from '@/lib/fish/quality';
import { definitionKey } from '@/lib/deepDig/features';
import { emptyPreEntryThreeStage, PRE_ENTRY_THREE_STAGE_VERSION } from '@/lib/fish/preEntryThreeStage';
import { freezeQualityPlan } from '@/lib/fish/qualityPlanVersions';

const storage = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), v4Load: vi.fn(), v4Save: vi.fn(), v2Load: vi.fn(), v2Save: vi.fn(), v1Load: vi.fn(), v1Save: vi.fn(), v3Load: vi.fn(), v3Save: vi.fn() }));
vi.mock('@/lib/fish/preEntryMonitorStore', () => ({ loadPreEntryLibrary: storage.v1Load, savePreEntryLibrary: storage.v1Save }));
vi.mock('@/lib/fish/preEntryMonitorV2Store', () => ({ loadPreEntryLibraryV2: storage.v2Load, savePreEntryLibraryV2: storage.v2Save }));
vi.mock('@/lib/fish/preEntryMonitorV3Store', () => ({ loadPreEntryLibraryV3: storage.v3Load, savePreEntryLibraryV3: storage.v3Save }));
vi.mock('@/lib/fish/preEntryMonitorV5Store', () => ({ loadPreEntryLibraryV5: storage.load, savePreEntryLibraryV5: storage.save }));
vi.mock('@/lib/fish/preEntryMonitorV4Store', () => ({ loadPreEntryLibraryV4: storage.v4Load, savePreEntryLibraryV4: storage.v4Save }));
const t = Date.UTC(2026, 2, 29, 5);
function study() {
  const s = importQualityLibrary(newQualityStudy(), [{ id: 's', symbol: 'TURING:TURING 1', timeMs: t, timeLabel: '', fallbackZone: '' }], t, 'turing');
  const def = { id: 'test', short: 'test', name: 'test', definition: '', formula: 'raw = C', scale: 1, unit: '', positive: '1', control: '0', interval: '5m' as const };
  return { ...s, independentFilters: true as const, selectedRowIds: qualityComparisonRows(s).map(r => r.id), buyFilters: [{ id: 'f', label: '买盘', enabled: true, metric: 'raw', direction: '>' as const, threshold: 100,
    snapshot: { featureId: def.id, featureShort: def.short, definitionKey: definitionKey(def), statistic: 'raw', interval: '5m' as const, scale: 1, direction: '>' as const, threshold: 100, cutoffMs: t, average: 0, cbi2: 0, startAverage: 0, previousAverage: 0 } }] };
}
beforeEach(() => { vi.clearAllMocks(); storage.load.mockImplementation(async () => emptyPreEntryLibrary()); storage.save.mockResolvedValue(undefined); storage.v4Load.mockResolvedValue(emptyPreEntryLibrary()); storage.v1Load.mockResolvedValue(emptyPreEntryLibrary()); storage.v2Load.mockResolvedValue(emptyPreEntryLibrary()); storage.v3Load.mockResolvedValue(emptyPreEntryLibrary()); });
it('persists a table-only clear without deleting history or frozen settings, and retains results when saving fails',async()=>{
 const input=study(),sample=qualityComparisonRows(input)[0],saved={...emptyPreEntryLibrary(),rounds:[{id:'r',state:'complete' as const,startedAt:t,updatedAt:t,filters:input.buyFilters,hours:1}],records:[{id:'record',roundId:'r',sample,status:'matched' as const,matchedAt:t+60000,startTime:t,cursor:t+60000,updatedAt:t+60000,readings:[{key:'f',value:101}]}]},before=structuredClone(saved);
 storage.load.mockResolvedValue(saved);const run=vi.fn(),h=renderHook(()=>usePreEntryMonitor('clear-owner',true,run));await waitFor(()=>expect(h.result.current.ready).toBe(true));
 storage.save.mockRejectedValueOnce(Error('保存失败'));await act(()=>h.result.current.clearTableResults());expect(h.result.current.library.records[0].tableClearedAt).toBeUndefined();
 await act(()=>h.result.current.clearTableResults());const result=h.result.current.library.records[0];expect(result.tableClearedAt).toBeGreaterThan(before.records[0].updatedAt);expect(result.updatedAt).toBe(before.records[0].updatedAt);expect(result.readings).toEqual(before.records[0].readings);expect(result.sample).toEqual(before.records[0].sample);expect(result.status).toBe('matched');expect(result.matchedAt).toBe(t+60000);expect(h.result.current.library.rounds).toEqual(before.rounds);expect(run).not.toHaveBeenCalled();expect(storage.v4Save).not.toHaveBeenCalled();
});
it('stops the current screening task before clearing its final displayed observations',async()=>{
 const run=vi.fn(async(task:QualityRunOptions)=>{const record=task.preEntry!.records[0];task.preEntry!.onRecord({...record,status:'scanning',readings:[{key:'f',value:123}],updatedAt:Date.now()});await new Promise<void>(resolve=>task.signal.addEventListener('abort',()=>resolve(),{once:true}));});
 const h=renderHook(()=>usePreEntryMonitor('clear-running',true,run));await waitFor(()=>expect(h.result.current.ready).toBe(true));act(()=>{void h.result.current.start(study(),1);});await waitFor(()=>expect(run).toHaveBeenCalledOnce());await act(()=>h.result.current.clearTableResults());
 expect(h.result.current.running).toBe(false);expect(h.result.current.library.records[0].tableClearedAt).toBeGreaterThan(h.result.current.library.records[0].updatedAt);expect(h.result.current.library.records[0].readings[0].value).toBe(123);expect(h.result.current.library.rounds[0].state).toBe('paused');
});
describe('买前监测独立任务', () => {
  it('retains both frozen settings when switching versions and can run the old set again',async()=>{
    const f=study().buyFilters[0],oldPlan=freezeQualityPlan({id:'old',label:'原版资产',metric:f.metric,snapshot:f.snapshot,rule:{metric:f.metric,direction:f.direction,threshold:f.threshold}});
    const saved={updatedAt:1,plans:[oldPlan],hours:12},before=structuredClone(saved);
    storage.v4Load.mockResolvedValue({...emptyPreEntryLibrary(),settings:saved});
    const tasks:QualityRunOptions[]=[],{result}=renderHook(()=>usePreEntryMonitor('alice',true,async task=>{tasks.push(task);}));
    await waitFor(()=>expect(result.current.ready).toBe(true));
    act(()=>result.current.configure([{id:'v5',label:'三阶副本',metric:f.metric,snapshot:f.snapshot,preEntryThreeStage:emptyPreEntryThreeStage()}],0));
    const oldId=result.current.library.settingsHistory![0].id;
    expect(result.current.library.settingsHistory![0].plans).toEqual(before.plans);
    act(()=>result.current.useSavedSettings(oldId));
    expect(result.current.library.settings!.plans[0].frozenVersions).toEqual(oldPlan.frozenVersions);
    await act(()=>result.current.start(study(),12));
    expect(tasks[0].preEntry!.round.engine).toBe(PRE_ENTRY_CONDITIONS_VERSION);
    const newId=result.current.library.settingsHistory!.find(s=>s.plans[0].id==='v5')!.id;
    act(()=>result.current.useSavedSettings(newId));
    await act(()=>result.current.start(study(),0));
    expect(tasks[1].preEntry!.round.engine).toBe(PRE_ENTRY_THREE_STAGE_VERSION);
    expect(saved).toEqual(before);expect(storage.v4Save).not.toHaveBeenCalled();
  });
  it('runs v5 only for explicitly configured three-stage copies and writes no older library',async()=>{
    const run=vi.fn(async(_options:QualityRunOptions)=>undefined),{result}=renderHook(()=>usePreEntryMonitor('alice',true,run));
    await waitFor(()=>expect(result.current.ready).toBe(true));
    const f=study().buyFilters[0],p={id:'v5',label:'三阶副本',metric:f.metric,snapshot:f.snapshot,preEntryThreeStage:emptyPreEntryThreeStage()};
    act(()=>result.current.configure([p],0));
    await act(()=>result.current.start(study(),0));
    expect(run.mock.calls[0][0].preEntry.round.engine).toBe(PRE_ENTRY_THREE_STAGE_VERSION);
    expect(storage.save).toHaveBeenCalled();
    for(const save of [storage.v4Save,storage.v3Save,storage.v2Save,storage.v1Save])expect(save).not.toHaveBeenCalled();
  });
  it('protects saved v5 settings from a newer timestamp written by an older page',async()=>{
    const f=study().buyFilters[0],p={id:'v5',label:'三阶副本',metric:f.metric,snapshot:f.snapshot,preEntryThreeStage:emptyPreEntryThreeStage()};
    storage.load.mockResolvedValue({...emptyPreEntryLibrary(),settings:{updatedAt:1,plans:[p],hours:3}});
    storage.v4Load.mockResolvedValue({...emptyPreEntryLibrary(),settings:{updatedAt:999,plans:[{...p,id:'old',preEntryThreeStage:undefined}],hours:999}});
    const {result}=renderHook(()=>usePreEntryMonitor('alice',true,vi.fn()));
    await waitFor(()=>expect(result.current.ready).toBe(true));
    expect(result.current.library.settings).toMatchObject({hours:3,plans:[{id:'v5'}]});
  });
  it('finishes a fully attempted round with data errors and retries only the frozen batch', async () => {
    const run = vi.fn(async (task: QualityRunOptions) => {
      const record = task.preEntry!.records[0];
      task.preEntry!.onRecord({ ...record, status: run.mock.calls.length === 1 ? 'error' : 'matched', detail: '历史不足', updatedAt: Date.now() });
      task.onProgress({ done: 0, total: 1, current: record.sample.source.symbol });
    });
    const { result } = renderHook(() => usePreEntryMonitor('alice', true, run));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(() => result.current.start(study(), 12));
    expect(result.current.library.rounds[0].state).toBe('complete');
    expect(result.current.progress).toMatchObject({ done: 1, total: 1 });
    expect(result.current.library.records[0].status).toBe('error');
    await act(() => result.current.resume(result.current.library.rounds[0].id, study()));
    expect(result.current.library.rounds).toHaveLength(1);
    expect(result.current.library.records[0].status).toBe('matched');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it.each(['error', 'queued'] as const)('recovers a legacy paused round containing a %s record', async status => {
    const input = study(), sample = qualityComparisonRows(input)[0];
    storage.load.mockResolvedValue({ ...emptyPreEntryLibrary(), rounds: [{ id: 'old', state: 'paused', startedAt: 1, updatedAt: 1, filters: [], hours: 0 }],
      records: [{ id: 'row', roundId: 'old', sample, status, startTime: t, cursor: t, readings: [], updatedAt: 1, detail: '历史不足' }] });
    const { result } = renderHook(() => usePreEntryMonitor('alice', true, vi.fn()));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.library.rounds[0].state).toBe(status === 'error' ? 'complete' : 'paused');
    expect(result.current.library.records[0]).toMatchObject({ status, detail: '历史不足' });
  });

  it('freezes selected rows and filters before starting and saves matches independently', async () => {
    let task!: QualityRunOptions, finish!: () => void;
    const run = vi.fn(async (options: QualityRunOptions) => { task = options; await new Promise<void>(resolve => { finish = resolve; }); });
    const { result } = renderHook(() => usePreEntryMonitor('alice', true, run));
    await waitFor(() => expect(result.current.ready).toBe(true));
    const input = study(); let started!: Promise<void>;
    act(() => { started = result.current.start(input, 12); });
    await waitFor(() => expect(run).toHaveBeenCalledOnce());
    input.buyFilters[0].threshold = 999;
    expect(task.preEntry!.round.filters[0].threshold).toBe(100);
    expect(task.preEntry!.records).toHaveLength(1);
    expect(task.preEntry!.round.engine).toBe(PRE_ENTRY_CONDITIONS_VERSION);
    expect(storage.save).toHaveBeenCalledWith('alice', expect.objectContaining({ rounds: [expect.objectContaining({ hours: 12 })] }));
    act(() => task.preEntry!.onRecord({ ...task.preEntry!.records[0], status: 'matched', matchedAt: t + 300000, updatedAt: Date.now() }));
    await act(async () => { finish(); await started; });
    expect(result.current.library.records[0].status).toBe('matched');
    expect(result.current.library.rounds[0].state).toBe('complete');
    expect(result.current.running).toBe(false);
  });
  it('ignores late results after switching accounts and cancels only its own task', async () => {
    let task!: QualityRunOptions, finish!: () => void;
    const run = async (options: QualityRunOptions) => { task = options; await new Promise<void>(resolve => { finish = resolve; }); };
    const { result, rerender } = renderHook(({ owner }) => usePreEntryMonitor(owner, true, run), { initialProps: { owner: 'alice' } });
    await waitFor(() => expect(result.current.ready).toBe(true));
    let started!: Promise<void>; act(() => { started = result.current.start(study(), 0); });
    await waitFor(() => expect(task).toBeDefined());
    rerender({ owner: 'bob' }); await waitFor(() => expect(result.current.ready).toBe(true));
    expect(task.signal.aborted).toBe(true);
    act(() => task.preEntry!.onRecord({ ...task.preEntry!.records[0], status: 'matched', matchedAt: t + 300000 }));
    await act(async () => { finish(); await started; });
    expect(result.current.library.records).toHaveLength(0);
    expect(storage.save.mock.calls.filter(([owner]) => owner === 'bob')).toHaveLength(0);
  });
  it('does not execute an unsaved round when local persistence fails', async () => {
    storage.save.mockRejectedValue(Error('磁盘写入失败'));
    const run = vi.fn(); const { result } = renderHook(() => usePreEntryMonitor('alice', true, run));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(() => result.current.start(study(), 0));
    expect(run).not.toHaveBeenCalled(); expect(result.current.error).toContain('磁盘写入失败');
    expect(result.current.library.rounds[0].state).toBe('paused');
  });
  it('waits for a running round to stop before restarting and retains both frozen rounds', async () => {
    const tasks: QualityRunOptions[] = []; let finishFirst!: () => void;
    const run = async (task: QualityRunOptions) => {
      tasks.push(task);
      if (tasks.length === 1) await new Promise<void>(resolve => { finishFirst = resolve; });
      else task.preEntry!.onRecord({ ...task.preEntry!.records[0], status: 'matched', matchedAt: t + 60000, updatedAt: Date.now() });
    };
    const { result } = renderHook(() => usePreEntryMonitor('alice', true, run));
    await waitFor(() => expect(result.current.ready).toBe(true));
    let first!: Promise<void>, restarted!: Promise<void>;
    act(() => { first = result.current.start(study(), 12); });
    await waitFor(() => expect(tasks).toHaveLength(1));
    const next = study();
    const plan = structuredClone(tasks[0].preEntry!.round.plans![0]);
    plan.rule!.threshold = 200;
    act(() => result.current.configure([plan], 24));
    act(() => { restarted = result.current.restart(next, 24); });
    expect(tasks[0].signal.aborted).toBe(true); expect(tasks).toHaveLength(1);
    await act(async () => { finishFirst(); await first; await restarted; });
    expect(tasks).toHaveLength(2);
    expect(tasks[0].preEntry!.round.filters[0].threshold).toBe(100);
    expect(tasks[1].preEntry!.round.filters[0].threshold).toBe(200);
    expect(result.current.library.rounds.map(r => [r.hours, r.state])).toEqual([[12, 'paused'], [24, 'complete']]);
    expect(result.current.library.records).toHaveLength(2);
  });
});

it('stores dynamic plans independently and freezes every plan before running',async()=>{
 const tasks:QualityRunOptions[]=[];
 const {result}=renderHook(()=>usePreEntryMonitor('separate-settings',true,async o=>{tasks.push(o);}));
 await waitFor(()=>expect(result.current.ready).toBe(true));
 const input=study();
 await act(()=>result.current.start(input,6));
 input.buyFilters[0].threshold=999;
 await act(()=>result.current.start(input,12));
 expect(tasks[1].preEntry!.round.filters[0].threshold).toBe(100);
 const first=tasks[1].preEntry!.round.plans![0];
 const second={...structuredClone(first),id:'second',label:'另一个买入方案',rule:{...first.rule!,threshold:200}};
 act(()=>result.current.configure([first,second],24));
 second.rule.threshold=300;
 await act(()=>result.current.start(input,24));
 expect(tasks[2].preEntry!.records).toHaveLength(2);
 expect(tasks[2].preEntry!.round.plans![1].rule!.threshold).toBe(200);
 expect(input.buyFilters[0].threshold).toBe(999);
});

it('imports v2 rounds without changing their engine and writes only to the v5 store', async () => {
 const input=study(), sample=qualityComparisonRows(input)[0];
 const old={...emptyPreEntryLibrary(),rounds:[{id:'old',engine:PRE_ENTRY_INTRABAR_VERSION,startedAt:1,updatedAt:1,state:'paused' as const,filters:input.buyFilters!,hours:0}],records:[{id:'old-row',roundId:'old',sample,status:'error' as const,startTime:t,cursor:t,readings:[],updatedAt:1,detail:'旧版缺失读数'}]};
 storage.v2Load.mockResolvedValue(old);
 const tasks:QualityRunOptions[]=[];
 const {result}=renderHook(()=>usePreEntryMonitor('migration',true,async task=>{tasks.push(task);}));
 await waitFor(()=>expect(result.current.ready).toBe(true));
 expect(result.current.library.records[0].detail).toBe('旧版缺失读数');
 await act(()=>result.current.resume('old',input));
 expect(tasks[0].preEntry!.round.engine).toBe(PRE_ENTRY_INTRABAR_VERSION);
 await act(()=>result.current.start(input,0));
 expect(tasks[1].preEntry!.round.engine).toBe(PRE_ENTRY_CONDITIONS_VERSION);
 expect(result.current.library.records).toHaveLength(2);
 expect(storage.save).toHaveBeenCalled();expect(storage.v3Save).not.toHaveBeenCalled();expect(storage.v2Save).not.toHaveBeenCalled();expect(storage.v1Save).not.toHaveBeenCalled();
 expect(old.rounds[0].engine).toBe(PRE_ENTRY_INTRABAR_VERSION);
});

it('keeps v5 settings when an old v3 page saved a later timestamp, while preserving its old round',async()=>{
 const current={updatedAt:10,hours:24,plans:[]},old={updatedAt:100,hours:48,plans:[]};
 storage.load.mockResolvedValue({...emptyPreEntryLibrary(),settings:current});
 storage.v3Load.mockResolvedValue({...emptyPreEntryLibrary(),settings:old,rounds:[{id:'v3',engine:PRE_ENTRY_ZERO_TRADE_VERSION,startedAt:1,updatedAt:1,state:'complete',filters:[],hours:48}]});
 const {result}=renderHook(()=>usePreEntryMonitor('settings-isolation',true,vi.fn()));
 await waitFor(()=>expect(result.current.ready).toBe(true));
 expect(result.current.library.settings).toEqual(current);
 expect(result.current.library.rounds[0].engine).toBe(PRE_ENTRY_ZERO_TRADE_VERSION);
 expect(storage.v3Save).not.toHaveBeenCalled();
});
