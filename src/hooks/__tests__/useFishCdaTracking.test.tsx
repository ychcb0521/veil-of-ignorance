import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useFishCdaTracking } from '../useFishCdaTracking';
import { readPageScreenedCda } from '../useFish';
import { readAutomaticPreEntryCheckpoint } from '@/lib/fish/preEntryPersistence';
import type { PreEntryLibrary, PreEntryRecord, PreEntryRound } from '@/lib/fish/preEntryMonitor';

vi.mock('../useFish', () => ({ readPageScreenedCda: vi.fn() }));
vi.mock('@/lib/fish/preEntryPersistence', () => ({ readAutomaticPreEntryCheckpoint: vi.fn() }));
afterEach(() => { localStorage.clear(); vi.useRealTimers(); vi.resetAllMocks(); });

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
  const sendCdaAlert = vi.fn(async (_r:PreEntryRecord,_s:PreEntryRound,_value:number,emails:string[], options:{onRecipient:(value:string)=>void}) => {
    options.onRecipient(emails[0]);
    return emails.length===1;
  });
  const notify = {config:{enabled:true,emails:['a@example.test','b@example.test'],serviceId:'service_test',templateId:'template_test',publicKey:'test'},sendCdaAlert};
  vi.mocked(readAutomaticPreEntryCheckpoint).mockImplementation(async (_owner, id) => {
    const source = records.find(x=>x.round.id===id)!;
    return {version:1,records:[source.record],rounds:[source.round]};
  });
  vi.mocked(readPageScreenedCda).mockImplementation(async (tasks,_snapshot,through,_signal,onRead) => {
    for(const {id} of tasks) onRead(id,{through,trigger:{at:through,value:-11.75}});
  });
  const mount = () => renderHook(() => useFishCdaTracking('fixture-cda',library,true,notify as never));
  let view=mount();
  expect(view.result.current.enabled).toBe(false);
  act(()=>view.result.current.setEnabled(true));
  expect(view.result.current.active).toBe(1);
  await act(()=>vi.advanceTimersByTimeAsync(4*M-1));
  expect(readPageScreenedCda).not.toHaveBeenCalled();
  await act(()=>vi.advanceTimersByTimeAsync(2001));
  expect(vi.mocked(readPageScreenedCda).mock.calls[0][0].map(task=>task.id)).toEqual(['NEW']);
  expect(sendCdaAlert.mock.calls[0].slice(2,4)).toEqual([-11.75,['a@example.test','b@example.test']]);
  view.unmount();view=mount();
  await act(()=>vi.advanceTimersByTimeAsync(9000));
  expect(sendCdaAlert.mock.calls[1].slice(2,4)).toEqual([-11.75,['b@example.test']]);
  expect(view.result.current.awaitingMail).toBe(0);
  await act(()=>vi.advanceTimersByTimeAsync(12*M));
  expect(readPageScreenedCda).toHaveBeenCalledOnce();
  expect(sendCdaAlert).toHaveBeenCalledTimes(2);
});
