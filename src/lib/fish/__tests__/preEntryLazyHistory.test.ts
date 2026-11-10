import {afterEach,expect,it,vi} from 'vitest';
import {collectPreEntryWithLazyHistory} from '../preEntryLazyHistory';
import type {PreEntryRecord,PreEntryRun} from '../preEntryMonitor';
const {engine,restore}=vi.hoisted(()=>({engine:vi.fn(),restore:vi.fn()}));
vi.mock('../preEntryMonitor',()=>({collectPreEntryMonitor:engine}));
vi.mock('../preEntryArchive',()=>({restorePreEntryRecord:restore}));
afterEach(()=>vi.resetAllMocks());
it('does not read later paused bodies until the preceding engine finishes, and preserves batch progress and inputs',async()=>{
  const rows=Array.from({length:3},(_,i)=>({id:String(i),status:'paused',processRef:{key:String(i),entries:100}} as PreEntryRecord));
  const task={round:{id:'frozen'},records:rows,onRecord:vi.fn()} as unknown as PreEntryRun;
  let release!:()=>void;const blocked=new Promise<void>(resolve=>{release=resolve;});
  restore.mockImplementation(async(r:PreEntryRecord)=>({...r,exclusionProcess:{version:1,entries:Array(100).fill({through:1})}}));
  engine.mockImplementation(async(t,_l,_n,_s,progress)=>{if(t.records[0].id==='0')await blocked;progress({done:1,total:1,current:t.records[0].id});t.onRecord(t.records[0]);});
  const progress=vi.fn(),run=collectPreEntryWithLazyHistory(task,vi.fn(),100,new AbortController().signal,progress);
  await vi.waitFor(()=>expect(engine).toHaveBeenCalledOnce());
  expect(restore.mock.calls.map(([r])=>r.id)).toEqual(['0']);expect(rows.every(r=>!r.exclusionProcess)).toBe(true);
  release();await run;
  expect(progress.mock.calls.map(([p])=>p)).toEqual(rows.map((r,i)=>({done:i+1,total:3,current:r.id})));
  expect(task.onRecord).toHaveBeenCalledTimes(3);expect(engine.mock.calls.every(([t])=>t.round===task.round)).toBe(true);
});
it('pauses between records before reading another body, leaving its original checkpoint intact',async()=>{
  const aborter=new AbortController(),rows=[{id:'a',status:'paused'},{id:'b',status:'paused'}] as PreEntryRecord[];
  restore.mockImplementation(async r=>r);engine.mockImplementation(async()=>{aborter.abort();});
  await expect(collectPreEntryWithLazyHistory({round:{id:'r',state:'paused',startedAt:1,updatedAt:1,filters:[],hours:1},records:rows,onRecord:vi.fn()},vi.fn(),100,aborter.signal,vi.fn())).rejects.toMatchObject({name:'AbortError'});
  expect(restore).toHaveBeenCalledOnce();expect(rows[1]).toEqual({id:'b',status:'paused'});
});
it('does not restore another large body while a slow page has not acknowledged the completed record',async()=>{
 const rows=[{id:'a',status:'paused'},{id:'b',status:'paused'}] as PreEntryRecord[];
 restore.mockImplementation(async r=>r);engine.mockResolvedValue(undefined);
 let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});
 const acknowledge=vi.fn().mockReturnValueOnce(pending).mockResolvedValue(undefined);
 const run=collectPreEntryWithLazyHistory({round:{id:'r',state:'paused',startedAt:1,updatedAt:1,filters:[],hours:1},records:rows,onRecord:vi.fn()},vi.fn(),100,new AbortController().signal,vi.fn(),undefined,acknowledge);
 await vi.waitFor(()=>expect(acknowledge).toHaveBeenCalledOnce());expect(restore).toHaveBeenCalledOnce();
 release();await run;expect(restore).toHaveBeenCalledTimes(2);expect(acknowledge).toHaveBeenCalledTimes(2);
});
