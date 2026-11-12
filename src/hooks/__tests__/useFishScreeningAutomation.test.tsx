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
  monitor.running = false;
  await wait(4000);
  expect(monitor.startAutomatic.mock.calls.map(([,source]) => source.symbol)).toEqual(['OKUSDT', 'BADUSDT']);
  expect(send).not.toHaveBeenCalled();
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
