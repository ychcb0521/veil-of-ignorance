import {useState} from 'react';
import {act,cleanup,renderHook} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {useQualityEntryReadings} from '../useQualityEntryReadings';
import {newQualityStudy,importQualityLibrary,qualityComparisonRows,qualityResultKey,type QualityRunOptions} from '@/lib/fish/quality';
import {enableQualityComparison} from '@/lib/fish/qualityComparison';
import {qualityEntryKey,type QualityEntryTarget,type QualityEntryReading} from '@/lib/fish/qualityEntry';
const T=Date.UTC(2026,9,20),M=60000;afterEach(cleanup);
function fixture(){const study=enableQualityComparison(importQualityLibrary(newQualityStudy(),[{id:'s',symbol:'AAAUSDT',timeMs:T,timeLabel:'',fallbackZone:''}])),row=qualityComparisonRows(study)[0];study.results=study.sellPlans!.map(plan=>({key:qualityResultKey(row,plan,0),sampleId:row.id,groupId:plan.id,evaluatedAt:T+M,status:'open' as const,entryTime:T,entryPrice:100}));return {study,row};}
function reading(t:QualityEntryTarget):QualityEntryReading{return {key:qualityEntryKey(t.source,t.result,t.plan,t.part)!,evaluatedAt:Date.now(),entryTime:T,mode:'intrabar',metric:t.part.metric,value:0,at:T,barOpenTime:T-5*M};}
it('queues visible-entry requests independently and never reruns or rewrites trades, retaining valid zero',async()=>{
 const {study,row}=fixture(),tasks:QualityRunOptions[]=[],resolve:(()=>void)[]=[],before=JSON.stringify(study.results),run=vi.fn((o:QualityRunOptions)=>new Promise<void>(done=>{tasks.push(o);resolve.push(done);}));
 const h=renderHook(()=>{const[value,setValue]=useState(study);return {value,entry:useQualityEntryReadings('a',true,value,run,setValue)};});
 act(()=>h.result.current.entry.request([study.sellPlans![0].id],[row.id]));act(()=>h.result.current.entry.request([study.sellPlans![1].id],[row.id]));expect(tasks).toHaveLength(1);
 await act(async()=>{tasks[0].onEntryReading!(reading(tasks[0].entryTargets![0]));resolve[0]();await Promise.resolve();});expect(tasks).toHaveLength(2);
 await act(async()=>{tasks[1].onEntryReading!(reading(tasks[1].entryTargets![0]));resolve[1]();await Promise.resolve();});expect(h.result.current.value.entryReadings).toHaveLength(2);expect(JSON.stringify(h.result.current.value.results)).toBe(before);expect(tasks.every(o=>o.task==='entry')).toBe(true);
 act(()=>h.result.current.entry.request(study.sellPlans!.map(p=>p.id),[row.id]));expect(run).toHaveBeenCalledTimes(2);
});
it('aborts old-account requests, rejects late callbacks and isolates cancellation from monitoring',async()=>{
 const {study,row}=fixture(),change=vi.fn(),tasks:QualityRunOptions[]=[],run=vi.fn((o:QualityRunOptions)=>new Promise<void>(resolve=>{tasks.push(o);o.signal.addEventListener('abort',()=>resolve());}));
 const h=renderHook(({owner})=>useQualityEntryReadings(owner,true,study,run,change),{initialProps:{owner:'a'}});
 act(()=>h.result.current.request([study.sellPlans![0].id],[row.id]));h.rerender({owner:'b'});expect(tasks[0].signal.aborted).toBe(true);act(()=>tasks[0].onEntryReading!(reading(tasks[0].entryTargets![0])));expect(change).not.toHaveBeenCalled();
 act(()=>h.result.current.request([study.sellPlans![0].id],[row.id]));await act(async()=>{h.result.current.cancel();await Promise.resolve();});expect(tasks[1].signal.aborted).toBe(true);act(()=>h.result.current.request([study.sellPlans![0].id],[row.id]));expect(tasks).toHaveLength(2);act(()=>h.result.current.request([study.sellPlans![0].id],[row.id],true));expect(tasks).toHaveLength(3);
});
