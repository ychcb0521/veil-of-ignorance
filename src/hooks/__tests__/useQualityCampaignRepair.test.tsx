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
