import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useQualityCampaignRepair } from '@/hooks/useQualityCampaignRepair';
import { newQualityStudy, importQualityLibrary, qualityComparisonRows, qualityResultKey, type FishQualityStudy } from '@/lib/fish/quality';
import { enableQualityComparison } from '@/lib/fish/qualityComparison';
import { archiveQualityStudy } from '@/lib/fish/qualityCampaignArchive';

const state=vi.hoisted(()=>({studies:new Map<string,FishQualityStudy>(),load:vi.fn(),save:vi.fn(),run:vi.fn()}));
vi.mock('@/lib/fish/qualityStore',()=>({loadQualityStudy:state.load,saveQualityStudy:state.save}));
vi.mock('@/lib/fishScanner',()=>({FishScanner:class {repairQuality(options:unknown){return state.run(options);}}}));
const T=Date.UTC(2026,3,2),M=60000;
beforeEach(()=>{
  state.studies.clear(); state.run.mockReset(); state.save.mockReset(); state.load.mockReset();
  const study=enableQualityComparison(importQualityLibrary(newQualityStudy(T),[{id:'lib',symbol:'AAAUSDT',timeMs:T,timeLabel:'',fallbackZone:''}]));
  const row=qualityComparisonRows(study)[0],p=study.sellPlans![0];p.rule={metric:'state',direction:'<',threshold:.5};
  study.results=[{key:qualityResultKey(row,p,0),sampleId:row.id,groupId:p.id,evaluatedAt:T+M,status:'closed',entryTime:T,entryPrice:10,endTime:T+10*M,endPrice:11,pnl:10,returnPct:10}];
  state.studies.set('a',archiveQualityStudy(study));
  state.load.mockImplementation(async(owner:string)=>({study:structuredClone(state.studies.get(owner)??newQualityStudy(T))}));
  state.save.mockImplementation(async(owner:string,study:FishQualityStudy)=>{state.studies.set(owner,structuredClone(study));return true;});
  state.run.mockImplementation(async({tasks,onResult})=>{for(const t of tasks)await onResult(t,{key:t.key,sampleId:t.sample.id,groupId:t.plan.id,evaluatedAt:T+20*M,status:'closed',complete:true,entryTime:T,entryPrice:10,endTime:T+10*M,endPrice:12,pnl:20,returnPct:20,peakPct:20,adversePct:0,drawdownPct:0,uncapturedPct:0,heldHours:1/6,exitReading:.4});});
});
afterEach(cleanup);
it('runs all prior campaigns without a row selection and persists corrected results before reporting completion',async()=>{
  const h=renderHook(()=>useQualityCampaignRepair('a'));
  await act(async()=>{await h.result.current.start();});
  expect(state.run).toHaveBeenCalledTimes(1); expect(state.studies.get('a')!.campaignRepair?.state).toBe('complete');
  expect(state.studies.get('a')!.campaignRuns![0].result.returnPct).toBe(20);
  expect(h.result.current.batch?.completedKeys).toHaveLength(1); expect(h.result.current.error).toBe('');
});
it('does not start market work when the initial correction checkpoint cannot be saved',async()=>{
  const before=structuredClone(state.studies.get('a'));state.save.mockResolvedValue(false);
  const h=renderHook(()=>useQualityCampaignRepair('a'));
  await act(async()=>{await h.result.current.start();});
  expect(state.run).not.toHaveBeenCalled();expect(h.result.current.error).toContain('未能保存');
  expect(state.studies.get('a')).toEqual(before);expect(h.result.current.batch?.state).not.toBe('complete');
});
it('pauses on an account change and cannot write the old repair into the new account',async()=>{
  state.run.mockImplementation(async({signal})=>new Promise<void>(resolve=>signal.addEventListener('abort',()=>resolve(),{once:true})));
  const h=renderHook(({owner})=>useQualityCampaignRepair(owner),{initialProps:{owner:'a'}});
  act(()=>{void h.result.current.start();});
  await waitFor(()=>expect(state.run).toHaveBeenCalledTimes(1));
  h.rerender({owner:'b'});
  await waitFor(()=>expect(state.studies.get('a')?.campaignRepair?.state).toBe('paused'));
  expect(state.save.mock.calls.every(([owner])=>owner==='a')).toBe(true);expect(h.result.current.batch).toBeUndefined();
});
it('reports each concurrent checkpoint only after that exact checkpoint has been saved',async()=>{
  const study=state.studies.get('a')!,first=study.campaignRuns![0],sample={...first.sample,id:'second'};
  study.campaignRuns!.push({...first,sample,result:{...first.result,key:qualityResultKey(sample,first.plan,first.observeHours),sampleId:sample.id}});
  const runOne=state.run.getMockImplementation()!;
  state.run.mockImplementation(async options=>{await Promise.all(options.tasks.map((task:unknown)=>runOne({...options,tasks:[task]})));});
  const pending:Array<()=>void>=[];
  state.save.mockImplementation((owner:string,value:FishQualityStudy)=>{
    const copy=structuredClone(value);
    if(copy.campaignRepair?.state==='running' && copy.campaignRepair.completedKeys.length) return new Promise<boolean>(resolve=>pending.push(()=>{state.studies.set(owner,copy);resolve(true);}));
    state.studies.set(owner,copy);return Promise.resolve(true);
  });
  const h=renderHook(()=>useQualityCampaignRepair('a'));
  let finished:Promise<void>=Promise.resolve();
  act(()=>{finished=h.result.current.start();});
  await waitFor(()=>expect(pending).toHaveLength(2));
  expect(h.result.current.batch?.completedKeys).toHaveLength(0);
  await act(async()=>{pending[0]();});
  expect(h.result.current.batch?.completedKeys).toHaveLength(1);
  await act(async()=>{pending[1]();await finished;});
  expect(h.result.current.batch?.completedKeys).toHaveLength(2);
  expect(h.result.current.batch?.state).toBe('complete');
});
it('does not announce complete when saving the final batch state fails',async()=>{
  const save=state.save.getMockImplementation()!;
  state.save.mockImplementation((owner,value)=>value.campaignRepair?.state==='complete'?Promise.resolve(false):save(owner,value));
  const h=renderHook(()=>useQualityCampaignRepair('a'));
  await act(async()=>{await h.result.current.start();});
  expect(h.result.current.batch?.completedKeys).toHaveLength(1);
  expect(h.result.current.batch?.state).not.toBe('complete');
  expect(h.result.current.error).toContain('未能保存');
  expect(state.studies.get('a')!.campaignRepair?.state).not.toBe('complete');
});
