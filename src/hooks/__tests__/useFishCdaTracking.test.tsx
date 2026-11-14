import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useFishCdaTracking } from '../useFishCdaTracking';
import { readPageScreenedCda, readPageInstantCampaignCandles, markPageInstantPosition } from '../useFish';
import { readAutomaticPreEntryCheckpoint } from '@/lib/fish/preEntryPersistence';
import type { ScreenedCdaTrigger } from '@/lib/fish/screenedCda';
import type { PreEntryLibrary, PreEntryRecord, PreEntryRound } from '@/lib/fish/preEntryMonitor';
import { instantPositionInput } from '@/lib/fish/instantCampaign';
import { readInstantPositionQuote } from '@/lib/fish/instantPositionQuote';
import { saveInstantCampaignInput } from '@/lib/fish/instantCampaignStore';

const preferences = vi.hoisted(() => new Map<string, unknown>());
vi.mock('@/lib/fish/fishPreferencesDb', () => ({
  readFishPreferences: async (keys: string[]) => keys.map(key => preferences.get(key)),
  readFishPreferenceEntries: async (prefix: string, filter = (_: unknown) => true) =>
    [...preferences].filter(([key, value]) => key.startsWith(prefix) && filter(value)).map(([key, value]) => [key.slice(prefix.length), value]),
  writeFishPreference: async (key: string, value: unknown) => { preferences.set(key, structuredClone(value)); },
  writeFishPreferences: async (entries: [string, unknown][]) => {
    for (const [key, value] of entries) preferences.set(key, structuredClone(value));
  },
}));
vi.mock('../useFish', () => ({ readPageScreenedCda: vi.fn(), readPageInstantCampaignCandles: vi.fn(), markPageInstantPosition: vi.fn() }));
vi.mock('@/lib/fish/preEntryPersistence', () => ({ readAutomaticPreEntryCheckpoint: vi.fn(), readAutomaticPreEntrySales: async () => [] }));
vi.mock('@/lib/fish/instantPositionQuote', () => ({ readInstantPositionQuote: vi.fn() }));
vi.mock('@/lib/fish/instantCampaignStore', () => ({ saveInstantCampaignInput: vi.fn(async () => undefined) }));
afterEach(() => { localStorage.clear(); preferences.clear(); vi.useRealTimers(); vi.resetAllMocks(); });

it('watches newly admitted automatic fish after enabling, survives reload and retries only unsent mail', async () => {
  const T=Date.UTC(2026,10,12), M=60000;
  vi.useFakeTimers({now:T+M});
  const make = (id:string, updatedAt:number, automatic:boolean) => {
    const source = {id,symbol:id,timeMs:T,timeLabel:'',fallbackZone:''};
    const record:PreEntryRecord = {id,roundId:id,status:'matched',updatedAt,matchedAt:T+2*M,
      startTime:T,cursor:T+2*M,readings:[],sample:{id,source,basis:'signal',groups:[],enteredAt:T,importedAt:T}};
    const round:PreEntryRound = {id,startedAt:T,updatedAt,hours:48,state:'complete',automatic,filters:[]};
    return {record,round};
  };
  const records = [make('OLD',T,true),make('MANUAL',T+2*M,false),make('NEW',T+2*M,true)];
  const library:PreEntryLibrary = {version:1,records:records.map(x=>x.record),rounds:records.map(x=>x.round)};
  const sendCdaAlert = vi.fn(async (_r:PreEntryRecord,_s:PreEntryRound,_trigger:ScreenedCdaTrigger,emails:string[], options:{onRecipient:(value:string)=>void|Promise<void>}) => {
    await options.onRecipient(emails[0]);
    return emails.length===1;
  });
  const notify = {config:{enabled:true,emails:['a@example.test','b@example.test'],serviceId:'service_test',templateId:'template_test',publicKey:'test'},sendCdaAlert};
  vi.mocked(readAutomaticPreEntryCheckpoint).mockImplementation(async (_owner, id) => {
    const source = records.find(x=>x.round.id===id)!;
    return {version:1,records:[source.record],rounds:[source.round]};
  });
  vi.mocked(readPageScreenedCda).mockImplementation(async (tasks,_snapshot,through,_signal,onRead) => {
    for(const {id} of tasks) await onRead(id,{through,trigger:{at:through,value:-11.75}});
  });
  const mount = () => renderHook(() => useFishCdaTracking('fixture-cda',library,true,notify as never));
  let view=mount();
  expect(view.result.current.enabled).toBe(false);
  await act(async () => {});
  const originalSet = Storage.prototype.setItem;
  const quota = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
    if (key.startsWith('veil.fish-cda-tracking')) throw new DOMException('storage full', 'QuotaExceededError');
    originalSet.call(this, key, value);
  });
  await act(() => view.result.current.setEnabled(true));
  expect(quota).not.toHaveBeenCalled();
  quota.mockRestore();
  expect(view.result.current.active).toBe(1);
  await act(()=>vi.advanceTimersByTimeAsync(4*M-1));
  expect(readPageScreenedCda).not.toHaveBeenCalled();
  await act(()=>vi.advanceTimersByTimeAsync(2001));
  expect(vi.mocked(readPageScreenedCda).mock.calls[0][0].map(task=>task.id)).toEqual(['NEW']);
  expect(sendCdaAlert.mock.calls[0].slice(2,4)).toEqual([{at:T+5*M,value:-11.75},['a@example.test','b@example.test']]);
  expect(view.result.current.alerts.get('NEW')).toEqual({at:T+5*M,value:-11.75});
  view.unmount();view=mount();
  await act(()=>vi.advanceTimersByTimeAsync(9000));
  expect(sendCdaAlert.mock.calls[1].slice(2,4)).toEqual([{at:T+5*M,value:-11.75},['b@example.test']]);
  expect(view.result.current.awaitingMail).toBe(0);
  await act(()=>vi.advanceTimersByTimeAsync(12*M));
  expect(readPageScreenedCda).toHaveBeenCalledOnce();
  expect(sendCdaAlert).toHaveBeenCalledTimes(2);
  await act(() => view.result.current.setEnabled(false));
  view.unmount();view=mount();
  await act(async () => {});
  expect(view.result.current.enabled).toBe(false);
  expect(view.result.current.alerts.get('NEW')).toEqual({at:T+5*M,value:-11.75});
  expect(view.result.current.alerts.size).toBe(1);
});

it('gives a confirmed manual action priority over an unpublished automatic exit and recovers protective orders', async () => {
  const minute = 60_000, buyAt = Date.UTC(2026, 10, 14, 1, 30);
  vi.useFakeTimers({ now: buyAt + minute + 1000 });
  const source = { id: 'TEST', symbol: 'TESTUSDT', timeMs: buyAt, timeLabel: '', fallbackZone: '' };
  const record: PreEntryRecord = { id: 'fish', roundId: 'round', matchedAt: buyAt, updatedAt: buyAt, status: 'matched',
    startTime: buyAt, cursor: buyAt, readings: [], sample: { id: 's', source, basis: 'signal', groups: [], enteredAt: buyAt, importedAt: buyAt } };
  const round: PreEntryRound = { id: record.roundId, startedAt: buyAt, updatedAt: buyAt, hours: 1, state: 'complete', automatic: true, filters: [] };
  const library: PreEntryLibrary = { version: 1, records: [record], rounds: [round] };
  const position = { ...instantPositionInput(record, round)!, entryPrice: 100, marginUsdt: 40, leverage: 5 };
  const notify = { config: { enabled: false, emails: [] } } as never;
  let finishAuto: (() => void) | undefined;
  vi.mocked(readAutomaticPreEntryCheckpoint).mockResolvedValue(library);
  vi.mocked(readPageScreenedCda).mockImplementation(async (_tasks, _snapshot, through, _signal, onResult) => {
    await new Promise<void>(resolve => { finishAuto = resolve; });
    await onResult(record.id, { through, trigger: { at: buyAt + 5 * minute, value: -11.75 } });
  });
  const originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
  let held = false;
  let previous = Promise.resolve();
  Object.defineProperty(navigator, 'locks', { configurable: true, value: {
    request: async (
      _name: string,
      options: { ifAvailable?: boolean },
      callback: (lock: object | null) => Promise<void>,
    ) => {
      if (options.ifAvailable && held) return callback(null);
      held = true;
      const work = previous.then(() => callback({}));
      previous = work.catch(() => undefined);
      try { await work; } finally { held = false; }
    },
  } });
  try {
    const mount = () => renderHook(() => useFishCdaTracking('manual-fixture', library, true, notify, true));
    let view = mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(finishAuto).toBeTypeOf('function');
    vi.mocked(readInstantPositionQuote).mockImplementation(async () => ({ at: Date.now(), price: 100, kind: 'mark' }));
    vi.mocked(markPageInstantPosition).mockImplementation(async () => ({ at: Date.now(), price: 100 }));
    await act(async () => {
      const user = view.result.current.managePosition!(position, { kind: 'protect', levels: { tp: 110, sl: 95, percentage: 50 } });
      finishAuto!();
      await user;
    });
    expect(view.result.current.alerts.size).toBe(0);
    expect(saveInstantCampaignInput).not.toHaveBeenCalled();
    expect(view.result.current.manualPositions?.get(record.id)?.orders).toEqual({ tp: 110, sl: 95, percentage: 50 });
    view.unmount();
    view = mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(view.result.current.manualPositions?.get(record.id)?.orders).toEqual({ tp: 110, sl: 95, percentage: 50 });
    vi.mocked(readPageInstantCampaignCandles).mockImplementation(async (_source, _interval, from, through) =>
      Array.from({ length: (through - from) / minute }, (_, index) => ({
        openTime: from + index * minute, open: 100, high: 111, low: 98, close: 111, volume: 1, takerBuyVolume: null,
      })));
    await act(() => vi.advanceTimersByTimeAsync(minute + 2000));
    const partial = view.result.current.manualPositions?.get(record.id);
    expect(partial?.orders).toEqual({ tp: null, sl: 95, percentage: 50 });
    expect(partial?.fills).toHaveLength(1);
    expect(partial?.fills[0]).toMatchObject({ reason: 'take-profit', fraction: .5, price: 111 });
    await act(() => view.result.current.managePosition!(position, { kind: 'close', fraction: 1 }));
    expect(view.result.current.alerts.get(record.id)?.manual?.fills.map(fill => fill.reason)).toEqual(['take-profit', 'manual']);
    expect(readPageScreenedCda).toHaveBeenCalledTimes(1);
    expect(saveInstantCampaignInput).toHaveBeenCalledTimes(1);
    view.unmount();
  } finally {
    if (originalLocks) Object.defineProperty(navigator, 'locks', originalLocks);
    else Reflect.deleteProperty(navigator, 'locks');
  }
});
