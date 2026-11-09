import {afterEach,expect,it,vi} from 'vitest';
import {screeningRecordDelta,applyScreeningRecordDelta,screeningError,restoreScreeningError,type ScreeningWorkerInput,type ScreeningWorkerOutput} from '../preEntryWorkerProtocol';
import {collectPreEntryInWorker} from '../preEntryWorkerClient';
import type {PreEntryRecord} from '../preEntryMonitor';
import {FishError} from '../shared';
const record=():PreEntryRecord=>({id:'a',roundId:'r',status:'scanning',startTime:1,cursor:1,updatedAt:1,readings:[],sample:{id:'a',source:{id:'a',symbol:'TESTUSDT',timeMs:1,timeLabel:'',fallbackZone:''},groups:[],enteredAt:1,basis:'signal',importedAt:1},exclusionProcess:{version:1,startedAt:1,entries:[{kind:'observation',stage:'exclusion',status:'blocked',from:1,through:1,count:1,reason:'未过前高'},{kind:'restart',from:1,through:1,count:1,reason:'下一分钟'}]}});
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
it('transfers only modified audit entries, preserving exact full history and previous immutable snapshots',()=>{
 const before=record(),copy=structuredClone(before),entries=before.exclusionProcess!.entries;
 const after={...before,cursor:2,exclusionProcess:{...before.exclusionProcess!,entries:[{...entries[0],through:2,count:2},entries[1],{...entries[1],from:2,through:2}]}};
 const delta=screeningRecordDelta(before,after);expect(delta.process!.updates.map(([i])=>i)).toEqual([0,2]);
 expect(applyScreeningRecordDelta(before,structuredClone(delta))).toEqual(after);expect(before).toEqual(copy);
 expect(applyScreeningRecordDelta(undefined,screeningRecordDelta(undefined,after))).toEqual(after);
 expect(()=>applyScreeningRecordDelta(after,delta)).toThrow('次序');
 const reset={...before,exclusionProcess:{...before.exclusionProcess!,entries:[]}};expect(applyScreeningRecordDelta(after,screeningRecordDelta(after,reset))).toEqual(reset);
});
it('retains gap/readings classifications across the worker boundary so fallback cannot bypass missing data',()=>{
 for(const kind of ['gap','readings','history','banned'] as const){const cause=new FishError('原始数据错误',kind,{status:429,path:'fixture'}),restored=restoreScreeningError(structuredClone(screeningError(cause)));expect(restored).toBeInstanceOf(FishError);expect(restored).toMatchObject({message:cause.message,kind,detail:cause.detail});}
 expect(restoreScreeningError(screeningError(new DOMException('暂停','AbortError'))).name).toBe('AbortError');
});
function setup(handler:(w:MockWorker,message:ScreeningWorkerInput)=>void){
 const stopped=vi.fn(),posted:ScreeningWorkerInput[]=[];
 class MockWorker{onmessage?:(e:{data:ScreeningWorkerOutput})=>void;onerror?:()=>void;terminate=stopped;postMessage(message:ScreeningWorkerInput){posted.push(message);queueMicrotask(()=>handler(this,message));}}
 vi.stubGlobal('Worker',MockWorker);
 const initial=record(),onRecord=vi.fn(),onProgress=vi.fn(),aborter=new AbortController(),load=vi.fn(async()=>[]),round={id:'r',state:'running' as const,startedAt:1,updatedAt:1,filters:[],hours:48};
 return {initial,onRecord,onProgress,aborter,load,stopped,posted,run:()=>collectPreEntryInWorker({round,records:[initial],onRecord},load,100,aborter.signal,onProgress)};
}
type MockWorker={onmessage?:(e:{data:ScreeningWorkerOutput})=>void;onerror?:()=>void};
it('acknowledges a reconstructed terminal result before releasing the worker',async()=>{
 const f=setup((worker,m)=>{if(m.type==='start'){const final={...m.records[0],status:'matched' as const,matchedAt:20,cursor:20};worker.onmessage?.({data:{type:'record',seq:1,delta:screeningRecordDelta(m.records[0],final)}});}if(m.type==='ack')worker.onmessage?.({data:{type:'done'}});});
 await f.run();expect(f.onRecord).toHaveBeenCalledOnce();expect(f.onRecord.mock.calls[0][0]).toMatchObject({status:'matched',cursor:20,matchedAt:20,exclusionProcess:f.initial.exclusionProcess});expect(f.posted.at(-1)).toEqual({type:'ack',seq:1});expect(f.stopped).toHaveBeenCalledOnce();
});
it('halts a failed worker and retains the last acknowledged cursor for explicit resume',async()=>{
 const f=setup((worker,m)=>{if(m.type==='start')worker.onerror?.();});
 await expect(f.run()).rejects.toThrow('最后进度已保留');expect(f.onRecord.mock.calls.at(-1)![0]).toMatchObject({status:'paused',cursor:1,exclusionProcess:f.initial.exclusionProcess});expect(f.stopped).toHaveBeenCalledOnce();expect(f.load).not.toHaveBeenCalled();
});
it('can pause even a nonresponsive formula worker without blocking the page or losing acknowledged history',async()=>{
 vi.useFakeTimers();const f=setup(()=>{}),running=f.run(),rejected=expect(running).rejects.toMatchObject({name:'AbortError'});f.aborter.abort();await vi.advanceTimersByTimeAsync(3000);await rejected;
 expect(f.posted.some(m=>m.type==='abort')).toBe(true);expect(f.stopped).toHaveBeenCalledOnce();expect(f.onRecord.mock.calls.at(-1)![0]).toMatchObject({status:'paused',cursor:1});
});
