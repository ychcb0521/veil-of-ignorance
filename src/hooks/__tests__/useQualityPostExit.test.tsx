import {useState} from 'react';
import {act,cleanup,renderHook} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {useQualityPostExit} from '../useQualityPostExit';
import {newQualityStudy,importQualityLibrary,qualityComparisonRows,qualityResultKey,type QualityRunOptions,type FishQualityStudy} from '@/lib/fish/quality';
import {enableQualityComparison} from '@/lib/fish/qualityComparison';
import {POST_EXIT_HOURS,qualityPostExitKey,type QualityPostExitReading,type QualityPostExitTarget} from '@/lib/fish/qualityPostExit';
const T=Date.UTC(2026,9,20),M=60000;
afterEach(()=>{cleanup();localStorage.clear();});
function fixture(){const study=enableQualityComparison(importQualityLibrary(newQualityStudy(),[{id:'s',symbol:'AAAUSDT',timeMs:T,timeLabel:'',fallbackZone:''}])),row=qualityComparisonRows(study)[0];study.results=study.sellPlans!.map((plan,i)=>({key:qualityResultKey(row,plan,0),sampleId:row.id,groupId:plan.id,evaluatedAt:T+10*M,status:'closed' as const,entryTime:T,entryPrice:100,endTime:T+(i+5)*M,endPrice:110+i,returnPct:10+i}));return {study,row};}
function reading(target:QualityPostExitTarget):QualityPostExitReading{return {key:qualityPostExitKey(target.source,target.result,target.plan)!,evaluatedAt:Date.now(),exitTime:target.result.endTime!,exitPrice:target.result.endPrice!,startMs:target.result.endTime!,excludedExitMinute:false,windows:POST_EXIT_HOURS.map(hours=>({hours,status:'ready',peakPct:1,drawdown2Pct:2}))};}
it('queues newly expanded algorithms during another backfill and updates only independent observations',async()=>{
 const {study,row}=fixture(),tasks:QualityRunOptions[]=[],resolve:(()=>void)[]=[],before=JSON.stringify(study.results);
 const run=vi.fn((o:QualityRunOptions)=>new Promise<void>(done=>{tasks.push(o);resolve.push(done);}));
 const h=renderHook(()=>{const [value,setValue]=useState(study);const post=useQualityPostExit('a',true,value,run,setValue);return {value,post};});
 act(()=>h.result.current.post.request([study.sellPlans![0].id],[row.id]));expect(tasks).toHaveLength(1);
 act(()=>h.result.current.post.request([study.sellPlans![1].id],[row.id]));expect(tasks).toHaveLength(1);
 await act(async()=>{tasks[0].onPostExitReading!(reading(tasks[0].postExitTargets![0]));resolve[0]();await Promise.resolve();});
 expect(tasks).toHaveLength(2);expect(tasks.every(o=>o.task==='post-exit')).toBe(true);
 await act(async()=>{tasks[1].onPostExitReading!(reading(tasks[1].postExitTargets![0]));resolve[1]();await Promise.resolve();});
 expect(h.result.current.value.postExitReadings).toHaveLength(2);expect(JSON.stringify(h.result.current.value.results)).toBe(before);expect(h.result.current.post.running).toBe(false);
 act(()=>h.result.current.post.request(study.sellPlans!.map(p=>p.id),[row.id]));expect(run).toHaveBeenCalledTimes(2);
});
it('rejects old-account callbacks and aborts their requests on account changes',async()=>{
 const {study,row}=fixture(),change=vi.fn(),tasks:QualityRunOptions[]=[];
 const run=vi.fn((o:QualityRunOptions)=>new Promise<void>(resolve=>{tasks.push(o);o.signal.addEventListener('abort',()=>resolve());}));
 const h=renderHook(({owner})=>useQualityPostExit(owner,true,study,run,change),{initialProps:{owner:'a'}});
 act(()=>h.result.current.request([study.sellPlans![0].id],[row.id]));h.rerender({owner:'b'});
 expect(tasks[0].signal.aborted).toBe(true);act(()=>tasks[0].onPostExitReading!(reading(tasks[0].postExitTargets![0])));expect(change).not.toHaveBeenCalled();expect(h.result.current.running).toBe(false);
});
it('pauses only the post-sale queue and resumes on explicit retry without re-running exits',async()=>{
 const {study,row}=fixture(),tasks:QualityRunOptions[]=[];
 const run=vi.fn((o:QualityRunOptions)=>new Promise<void>(resolve=>{tasks.push(o);o.signal.addEventListener('abort',()=>resolve());}));
 const h=renderHook(()=>useQualityPostExit('a',true,study,run,vi.fn()));
 act(()=>h.result.current.request([study.sellPlans![0].id],[row.id]));await act(async()=>{h.result.current.cancel();await Promise.resolve();});
 expect(tasks[0].signal.aborted).toBe(true);act(()=>h.result.current.request([study.sellPlans![0].id],[row.id]));expect(run).toHaveBeenCalledTimes(1);
 act(()=>h.result.current.request([study.sellPlans![0].id],[row.id],true));expect(run).toHaveBeenCalledTimes(2);expect(tasks.every(o=>o.task==='post-exit')).toBe(true);
});
