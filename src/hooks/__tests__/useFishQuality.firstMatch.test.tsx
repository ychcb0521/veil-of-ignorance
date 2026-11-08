import {act,cleanup,renderHook,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {useFishQuality} from '../useFishQuality';
import {firstMatchFixture,SIGNAL_AT,MATCHED_AT} from '@/lib/fish/__tests__/qualityFirstMatch.fixture';
import {qualityDisplayRows,qualityRunSamples,qualityResultKey,type QualityRunOptions} from '@/lib/fish/quality';
import {qualityMonitorEntryAt} from '@/lib/fish/qualityAdmissionTime';
import {qualityRowResult} from '@/lib/fish/qualityComparison';

const fixture=firstMatchFixture();
let screeningReady=true;
vi.mock('@/lib/fish/qualityStore',()=>({loadQualityStudy:async()=>({study:structuredClone(fixture.study)}),saveQualityStudy:vi.fn(async()=>true)}));
vi.mock('../usePreEntryMonitor',()=>({usePreEntryMonitor:()=>({ready:screeningReady,library:fixture.library})}));
afterEach(()=>{cleanup();localStorage.clear();screeningReady=true;});

it('runs a selected original signal from its first match and records the corrected campaign without changing its selection or saved plan',async()=>{
 const tasks:QualityRunOptions[]=[],empty:never[]=[];
 const run=vi.fn(async(options:QualityRunOptions)=>{
  tasks.push(options);
  const sample=qualityRunSamples(options.study)[0],plan=options.study.sellPlans![0];
  options.onResult({key:qualityResultKey(sample,plan,0),sampleId:sample.id,groupId:plan.id,status:'open',entryTime:qualityMonitorEntryAt(sample)!,entryPrice:104,endTime:MATCHED_AT+60000,endPrice:104,returnPct:0,pnl:0,evaluatedAt:MATCHED_AT+60000});
 });
 const h=renderHook(()=>useFishQuality('first-match-owner',empty,run));
 await waitFor(()=>expect(h.result.current.ready&&qualityMonitorEntryAt(h.result.current.study.samples[0])===MATCHED_AT).toBe(true));
 const row=qualityDisplayRows(h.result.current.study).find(r=>!r.source.preEntryMonitor)!;
 expect(row.enteredAt).toBe(SIGNAL_AT);
 act(()=>{h.result.current.setSelectedRows([row.id]);h.result.current.setScope([row.id]);});
 const plans=structuredClone(h.result.current.study.sellPlans);
 await act(()=>h.result.current.start());
 expect(tasks).toHaveLength(1);expect(qualityRunSamples(tasks[0].study)).toHaveLength(1);
 expect(qualityMonitorEntryAt(qualityRunSamples(tasks[0].study)[0])).toBe(MATCHED_AT);
 expect(h.result.current.study.selectedRowIds).toEqual([row.id]);expect(h.result.current.study.sellPlans).toEqual(plans);
 const current=qualityDisplayRows(h.result.current.study).find(r=>r.id===row.id)!;
 expect(qualityRowResult(h.result.current.study,current,h.result.current.study.sellPlans![0])).toMatchObject({entryTime:MATCHED_AT,entryPrice:104});
 expect(h.result.current.study.campaignRuns![0].sample.enteredAt).toBe(MATCHED_AT);
 expect(h.result.current.study.monitorLibrary!.records[0].enteredAt).toBe(MATCHED_AT);
});

it('waits for screening history before freezing a monitoring buy time',async()=>{
 screeningReady=false;
 const empty:never[]=[],run=vi.fn(async()=>undefined),h=renderHook(()=>useFishQuality('loading-first-match',empty,run));
 await waitFor(()=>expect(h.result.current.ready).toBe(true));
 await act(()=>h.result.current.start());
 expect(run).not.toHaveBeenCalled();expect(h.result.current.error).toContain('筛选记录尚未恢复');
 screeningReady=true;h.rerender();
 await waitFor(()=>expect(qualityMonitorEntryAt(h.result.current.study.samples[0])).toBe(MATCHED_AT));
 expect(run).not.toHaveBeenCalled();
});
