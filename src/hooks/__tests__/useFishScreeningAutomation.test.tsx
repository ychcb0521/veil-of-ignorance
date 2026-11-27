import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useFishScreeningAutomation } from '../useFishScreeningAutomation';
import type { AutomaticScreeningMatch } from '../usePreEntryMonitor';
import { readAutomaticPreEntryCheckpoint } from '@/lib/fish/preEntryPersistence';
import type { PreEntryLibrary, PreEntryRecord, PreEntryRound, PreEntrySettings } from '@/lib/fish/preEntryMonitor';
import { FISH_AUTOMATIC_SCREENING_KEY } from '@/lib/fish/preEntryActivePlan';
import { emptyPreEntryThreeStage } from '@/lib/fish/preEntryThreeStage';
import { notifyPersistedStateHydrated, writePersistedStateRaw } from '@/lib/persistedStateStorage';
import type { TradeSignal } from '@/lib/signalLibrary';

vi.mock('@/lib/fish/preEntryPersistence', () => ({ readAutomaticPreEntryCheckpoint: vi.fn() }));
afterEach(() => { vi.useRealTimers(); localStorage.clear(); vi.clearAllMocks(); });
const T = Date.UTC(2026, 10, 12);
const signal = (symbol: string): TradeSignal => ({ id: symbol, symbol, timeMs: T, timeLabel: '', fallbackZone: '' });

it('queues a capture once, waits for a durable match, and retries only the unsent recipient after reload', async () => {
  vi.useFakeTimers({ now: T });
  const library: PreEntryLibrary = { version: 1, rounds: [], records: [], settings: { updatedAt: T, plans: [{} as never], hours: 48 } };
  const writeResult = (id: string, source: TradeSignal, status: PreEntryRecord['status']) => {
    if (!library.rounds.some(round => round.id === id)) library.rounds.push({
      id, startedAt: T, updatedAt: T, filters: [], hours: 48, state: 'complete', automatic: true,
    });
    const row: PreEntryRecord = {
      id: id + ':0:plan', roundId: id, startTime: T, cursor: T, updatedAt: Date.now(), readings: [],
      sample: { id: source.id, source, basis: 'signal', groups: [], importedAt: T, enteredAt: T }, status,
      ...(status === 'matched' ? { matchedAt: T + 60_000 } : {}),
    };
    library.records = [...library.records.filter(record => record.roundId !== id), row];
  };
  const monitor = { ready: true, running: true, library, startAutomatic: vi.fn(async (id: string, source: TradeSignal) => {
    writeResult(id, source, source.symbol === 'BADUSDT' ? 'unmatched' : 'queued');
  }) };
  const send = vi.fn(async (_record: PreEntryRecord, _round: PreEntryRound, recipients: string[], receipt: { onRecipient: (email: string) => void }) => {
    receipt.onRecipient(recipients[0]);
    return recipients.length === 1;
  });
  const notify = { config: { enabled: true, emails: ['a@example.test', 'b@example.test'], serviceId: 'service_demo', templateId: 'template_demo', publicKey: 'key' }, sendAdmission: send };
  const mount = () => renderHook(() => useFishScreeningAutomation('test-owner', true, monitor as never, notify as never));
  const wait = (time = 1400) => act(async () => { await vi.advanceTimersByTimeAsync(time); });
  let view = mount();
  act(() => { view.result.current.enqueue(signal('OKUSDT')); view.result.current.enqueue(signal('OKUSDT')); view.result.current.enqueue(signal('BADUSDT')); });
  await wait();
  expect(monitor.startAutomatic).not.toHaveBeenCalled();
  expect(view.result.current.screeningPending).toBe(true);
  monitor.running = false;
  await wait(4000);
  expect(monitor.startAutomatic.mock.calls.map(([,source]) => source.symbol)).toEqual(['OKUSDT', 'BADUSDT']);
  expect(send).not.toHaveBeenCalled();
  expect(view.result.current.screeningPending).toBe(true);
  const [id, source] = monitor.startAutomatic.mock.calls[0];
  writeResult(id, source, 'matched');
  await wait();
  expect(send).not.toHaveBeenCalled();
  vi.mocked(readAutomaticPreEntryCheckpoint).mockResolvedValue({ version: 1, records: library.records.filter(record => record.roundId === id), rounds: library.rounds.filter(round => round.id === id) });
  await wait();
  expect(send.mock.calls[0][2]).toEqual(['a@example.test', 'b@example.test']);
  view.unmount();
  view = mount();
  await wait(63_000);
  expect(send.mock.calls[1][2]).toEqual(['b@example.test']);
  expect(view.result.current.pending).toBe(0);
  expect(view.result.current.awaitingMail).toBe(0);
  expect(view.result.current.screeningPending).toBe(false);
  act(() => view.result.current.enqueue(source));
  await wait(2500);
  expect(send).toHaveBeenCalledTimes(2);
});

it('sends immediately after a committed match while manual screening is still running', async () => {
  vi.useFakeTimers({now:T});
  const library:PreEntryLibrary={version:1,rounds:[],records:[],settings:{updatedAt:T,plans:[{} as never],hours:48}};
  let confirm: (() => void) | undefined;
  const monitor={ready:true,running:true,automaticRunning:false,library,startAutomatic:vi.fn(async (id:string,source:TradeSignal,_recover:boolean,onMatch:(match:AutomaticScreeningMatch)=>void)=>{
    await new Promise<void>(resolve=>{confirm=resolve;});
    const round:PreEntryRound={id,startedAt:T,updatedAt:T,filters:[],hours:48,state:'complete',automatic:true};
    const record:PreEntryRecord={id:id+':0:p',roundId:id,status:'matched',startTime:T,cursor:T,matchedAt:T,updatedAt:T,readings:[],
      sample:{id:source.id,source,basis:'signal',groups:[],importedAt:T,enteredAt:T}};
    onMatch({record,round});
  })};
  const sendAdmission=vi.fn(async()=>true);
  const notify={config:{enabled:true,emails:['a@example.test'],serviceId:'service_demo',templateId:'template_demo',publicKey:'key'},sendAdmission};
  const view=renderHook(()=>useFishScreeningAutomation('instant-owner',true,monitor as never,notify as never));
  await act(async()=>{view.result.current.enqueue(signal('INSTANTUSDT'));});
  expect(monitor.startAutomatic).toHaveBeenCalledOnce();
  expect(sendAdmission).not.toHaveBeenCalled();
  await act(async()=>confirm?.());
  expect(Date.now()).toBe(T);
  expect(monitor.running).toBe(true);
  expect(sendAdmission).toHaveBeenCalledOnce();
  expect(view.result.current.awaitingMail).toBe(0);
  expect(view.result.current.pending).toBe(0);
});

it('freezes the independently saved settings per catch, including queued work resumed after a reload', async () => {
  vi.useFakeTimers({now:T});
  const owner = 'independent-owner', key = 'sim_'+owner+'_'+FISH_AUTOMATIC_SCREENING_KEY;
  const config = (label: string, hours: number): PreEntrySettings => ({
    updatedAt: T, hours, plans: [{id:label,label,preEntryThreeStage:emptyPreEntryThreeStage()} as PreEntrySettings['plans'][number]],
  });
  const savedA = config('自动 A', 4), savedB = config('自动 B', 6);
  const library: PreEntryLibrary = {version:1,rounds:[],records:[],settings:config('手动 A', 48)};
  const startAutomatic = vi.fn(async (_id:string,_source:TradeSignal,_recover:boolean,_onMatch:unknown,_settings?:PreEntrySettings) => {});
  const monitor = {ready:true,running:false,automaticRunning:false,library,startAutomatic};
  const notify = {config:{enabled:false},sendAdmission:vi.fn()};
  writePersistedStateRaw(key, JSON.stringify(savedA));
  const mount = () => renderHook(() => useFishScreeningAutomation(owner,true,monitor as never,notify as never));
  const first = mount();
  act(() => {
    first.result.current.setAutoPaused(true);
    first.result.current.enqueue(signal('EARLYUSDT'));
    library.settings = config('手动 B', 72);
    writePersistedStateRaw(key, JSON.stringify(savedB));
    notifyPersistedStateHydrated(key);
    first.result.current.enqueue(signal('LATEUSDT'));
  });
  expect(startAutomatic).not.toHaveBeenCalled();
  first.unmount();
  const second = mount();
  await act(async () => {
    second.result.current.setAutoPaused(false);
    await vi.advanceTimersByTimeAsync(2500);
  });
  expect(startAutomatic.mock.calls.map(([,source,,,settings])=>[source.symbol,settings])).toEqual([
    ['EARLYUSDT',savedA],['LATEUSDT',savedB],
  ]);
  expect(library.settings?.plans[0].label).toBe('手动 B');
});


it('runs a fresh capture once with its frozen settings while legacy work waits for its archive', async () => {
  vi.useFakeTimers({now:T});
  const owner = 'priority', prefix = 'veil.fish-screening-queue.v1:' + owner + ':';
  const saved = { updatedAt:T, hours:4, plans:[{id:'plan',label:'买前',preEntryThreeStage:emptyPreEntryThreeStage()}] };
  const legacy = {key:prefix+'job:legacy', id:'old', source:signal('OLD'), settings:saved, nextCheckAt:0};
  localStorage.setItem(legacy.key, JSON.stringify(legacy));
  writePersistedStateRaw('sim_'+owner+'_'+FISH_AUTOMATIC_SCREENING_KEY,JSON.stringify(saved));
  const monitor = {ready:false,instantReady:true,library:{version:1,records:[],rounds:[]},startAutomatic:vi.fn(async()=>{})};
  const notify = {config:{enabled:false}, sendAdmission:vi.fn()};
  const h = renderHook(({ready}) => useFishScreeningAutomation(owner,ready,monitor as never,notify as never), {initialProps:{ready:false}});
  await act(async () => { h.result.current.enqueue(signal('NEW'),T); h.result.current.enqueue(signal('NEW'),T); });
  expect(monitor.startAutomatic).not.toHaveBeenCalled();
  h.rerender({ready:true});
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  expect(monitor.startAutomatic.mock.calls).toHaveLength(1);
  expect(monitor.startAutomatic).toHaveBeenCalledWith(expect.any(String),signal('NEW'),false,expect.any(Function),saved,true,T);
  expect(h.result.current.needsHistory).toBe(true);
  monitor.ready=true; h.rerender({ready:true});
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  expect(monitor.startAutomatic).toHaveBeenCalledTimes(2);
  expect(monitor.startAutomatic).toHaveBeenLastCalledWith('old', legacy.source, false, expect.any(Function), saved, undefined, undefined);
  h.unmount();
});

it('leaves an empty or paused queue dormant and wakes immediately when a queued capture may run',async()=>{
 vi.useFakeTimers({now:T});
 const timeouts=vi.spyOn(globalThis,'setTimeout'), intervals=vi.spyOn(globalThis,'setInterval');
 const scheduledScanPoll=()=>[...timeouts.mock.calls,...intervals.mock.calls].some(([,ms])=>ms===1200);
 const library:PreEntryLibrary={version:1,rounds:[],records:[],settings:{updatedAt:T,plans:[{} as never],hours:48}};
 const monitor={ready:true,running:false,library,pauseAutomatic:vi.fn(),startAutomatic:vi.fn(async()=>{})};
 const notify={config:{enabled:false,emails:[]},sendAdmission:vi.fn()};
 const view=renderHook(()=>useFishScreeningAutomation('dormant-screening',true,monitor as never,notify as never));
 await act(async()=>vi.advanceTimersByTimeAsync(60_000));
 expect(scheduledScanPoll()).toBe(false);
 await act(async()=>{view.result.current.setAutoPaused(true);view.result.current.enqueue(signal('PAUSEDUSDT'));});
 expect(view.result.current.pending).toBe(1);
 expect(monitor.startAutomatic).not.toHaveBeenCalled();
 expect(scheduledScanPoll()).toBe(false);
 await act(async()=>view.result.current.setAutoPaused(false));
 await act(async()=>vi.advanceTimersByTimeAsync(10));
 expect(monitor.startAutomatic).toHaveBeenCalledOnce();
 timeouts.mockRestore(); intervals.mockRestore();
});

it('screens a fresh live capture before overdue work, then processes the backlog', async () => {
  vi.useFakeTimers({now:T});
  const startAutomatic = vi.fn(async (_id:string, _source:TradeSignal) => {});
  const monitor = {ready:true, running:true, library:{version:1,rounds:[],records:[],settings:{updatedAt:T,hours:48,plans:[{}]}},startAutomatic};
  const view = renderHook(() => useFishScreeningAutomation('fresh-first', true, monitor as never, {config:{enabled:false}} as never));
  await act(async () => {
    view.result.current.enqueue(signal('BACKLOG'), T - 121_000);
    view.result.current.enqueue(signal('FRESH'), T);
  });
  monitor.running = false;
  await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
  expect(startAutomatic.mock.calls.map(([,source]) => source.symbol)).toEqual(['FRESH','BACKLOG']);
});

it('freezes direct admission for a new catch without inheriting manual conditions',async()=>{
  vi.useFakeTimers({now:T});
  const owner='direct-selection',config={updatedAt:T,hours:4,plans:[{id:'manual',label:'manual',preEntryThreeStage:emptyPreEntryThreeStage()}]};
  const startAutomatic=vi.fn(async()=>{});
  const monitor={ready:true,running:false,library:{rounds:[],records:[],settings:config},startAutomatic};
  const h=renderHook(()=>useFishScreeningAutomation(owner,true,monitor as never,{config:{enabled:false}} as never));
  await act(async()=>{h.result.current.setAutoPaused(true);h.result.current.enqueue(signal('NEW'),T);});
  writePersistedStateRaw('sim_'+owner+'_'+FISH_AUTOMATIC_SCREENING_KEY,JSON.stringify(config));
  await act(async()=>{h.result.current.setAutoPaused(false);await vi.advanceTimersByTimeAsync(2000);});
  expect(startAutomatic).toHaveBeenCalledWith(expect.any(String),signal('NEW'),false,expect.any(Function),
    expect.objectContaining({screeningEnabled:false,plans:[]}),true,T);
});
