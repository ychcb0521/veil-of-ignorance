import { expect, it, vi } from 'vitest';
import { STATE_DEF, definitionKey } from '@/lib/deepDig/features';
import { newQualityStudy, importQualityLibrary, qualityComparisonRows, qualityResultKey, type QualityResult } from '@/lib/fish/quality';
import { enableQualityComparison, syncQualitySellDefinitions } from '@/lib/fish/qualityComparison';
import { archiveQualityStudy } from '@/lib/fish/qualityCampaignArchive';
import { qualityCampaignDataFromStudy } from '@/lib/fish/qualityCampaigns';
import { buildQualitySheets } from '@/lib/fish/qualityExport';
import { applyQualityRepair, collectQualityRepair, finishQualityRepair, prepareQualityRepair, preserveQualityRepairs, stopQualityRepair } from '@/lib/fish/qualityRepair';
const T=Date.UTC(2026,3,2,9,10), M=60000;
const oldDef={...STATE_DEF,formula:'state = C / 100'}, currentDef={...STATE_DEF,formula:'state = C / 200'};
function seed() {
  let study=enableQualityComparison(importQualityLibrary(newQualityStudy(T),[{id:'s',symbol:'STOUSDT',timeMs:T,timeLabel:'',fallbackZone:'',quality:3}]),[oldDef]);
  const row=qualityComparisonRows(study)[0], plan=study.sellPlans![0];
  plan.rule={metric:'state',direction:'<',threshold:.5};
  study.sellPlans=[plan]; study.selectedRowIds=[row.id];
  const result:QualityResult={key:qualityResultKey(row,plan,0),sampleId:row.id,groupId:plan.id,evaluatedAt:T+100*M,status:'closed',complete:true,entryTime:T,entryPrice:100,endTime:T+10*M,endPrice:40,returnPct:-60,pnl:-60,peakPct:10,adversePct:-70,drawdownPct:70,uncapturedPct:70,heldHours:1/6,exitReading:.4};
  study.results=[result]; study=archiveQualityStudy(study);
  return {study,row,plan,result};
}
const resultFor=(task:ReturnType<typeof prepareQualityRepair>['tasks'][number],pct=-5):QualityResult=>({key:task.key,sampleId:task.sample.id,groupId:task.plan.id,evaluatedAt:T+100*M,status:'closed',complete:true,entryTime:T,entryPrice:100,endTime:T+5*M,endPrice:100+pct,returnPct:pct,pnl:pct,peakPct:10,adversePct:-10,drawdownPct:15,uncapturedPct:10-pct,heldHours:1/12,exitReading:.4});

it('replaces old formula results once, preserves original evidence and keeps statistics and exports on the same corrected trade',()=>{
  const {study,row,result}=seed(), before=structuredClone(study);
  const active=syncQualitySellDefinitions(study,[currentDef]), prepared=prepareQualityRepair(active,[currentDef],T+200*M);
  expect(prepared.tasks).toHaveLength(1);
  expect(qualityCampaignDataFromStudy('owner',prepared.study,'sell')).toHaveLength(0);
  const task=prepared.tasks[0];
  const next=applyQualityRepair(prepared.study,prepared.batch.id,task,resultFor(task),T+201*M);
  const old=next.campaignRuns!.find(run=>run.result.key===result.key)!;
  expect(old.result).toEqual(result); expect(old.supersededBy).toBe(task.key);
  const data=qualityCampaignDataFromStudy('owner',next,'sell');
  expect(data).toHaveLength(1); expect(data[0].campaign.final_realized_pnl).toBe(-5);
  expect(next.results).toHaveLength(1); expect(next.results[0].key).toBe(task.key);
  const sheets=buildQualitySheets(next,[row]);
  expect(sheets[1].rows).toHaveLength(1); expect(sheets[1].rows[0][13]).toBe(-5);
  expect(sheets[2].name).toBe('纠错记录'); expect(sheets[2].rows.some(r=>r[6]===-60&&r[8]===-5)).toBe(true);
  expect(applyQualityRepair(next,prepared.batch.id,task,resultFor(task),T+202*M)).toBe(next);
  expect(study).toEqual(before);
});
it('coalesces an already recomputed duplicate and keeps detector attribution, thresholds and observation horizons',()=>{
  const {study,row}=seed(), active=syncQualitySellDefinitions(study,[currentDef]), plan=active.sellPlans![0];
  const old=study.campaignRuns![0], duplicate={...old,plan,result:{...old.result,key:qualityResultKey(row,plan,0)},detectors:[{...plan,id:'detector-b'}],detectionAt:T+M};
  const variantPlan={...plan,rule:{...plan.rule!,threshold:.4}};
  const variant={...duplicate,plan:variantPlan,result:{...duplicate.result,key:qualityResultKey(row,variantPlan,0)}};
  const horizon={...duplicate,observeHours:12,result:{...duplicate.result,key:qualityResultKey(row,plan,12)}};
  const prepared=prepareQualityRepair({...active,campaignRuns:[old,duplicate,variant,horizon]},[currentDef],T+200*M);
  expect(prepared.tasks).toHaveLength(3);
  const task=prepared.tasks.find(t=>t.observeHours===0&&t.plan.rule?.threshold===.5)!;
  expect(task.originals).toHaveLength(2);
  const next=applyQualityRepair(prepared.study,prepared.batch.id,task,resultFor(task),T+M);
  const canonical=next.campaignRuns!.find(r=>r.result.key===task.key)!;
  expect(canonical.detectors.map(d=>d.id)).toContain('detector-b'); expect(canonical.detectionAt).toBe(T+M);
  expect(next.campaignRuns!.filter(r=>!r.supersededBy)).toHaveLength(3);
});
it('excludes failed records, records the reason and resumes only unfinished targets after a reload',()=>{
  const {study}=seed(), second={...study.campaignRuns![0],sample:{...study.campaignRuns![0].sample,id:'other',source:{...study.samples[0].source,symbol:'OTHERUSDT'}}};
  second.result={...second.result,key:qualityResultKey(second.sample,second.plan,0),sampleId:second.sample.id};
  const prepared=prepareQualityRepair({...study,campaignRuns:[...study.campaignRuns!,second]},[currentDef],T+200*M);
  let next=applyQualityRepair(prepared.study,prepared.batch.id,prepared.tasks[0],resultFor(prepared.tasks[0]),T+M);
  next=applyQualityRepair(next,prepared.batch.id,prepared.tasks[1],{...resultFor(prepared.tasks[1]),status:'error',reason:'行情缺口'},T+2*M);
  expect(qualityCampaignDataFromStudy('owner',next,'sell')).toHaveLength(1);
  expect(Object.values(next.campaignRepair!.failures)).toEqual(['行情缺口']);
  next=finishQualityRepair(next,prepared.batch.id,true,T+3*M);
  const resumed=prepareQualityRepair(structuredClone(next),[currentDef],T+300*M);
  expect(resumed.batch.id).toBe(prepared.batch.id); expect(resumed.tasks).toHaveLength(1);
  expect(resumed.tasks[0].sample.source.symbol).toBe('OTHERUSDT');
});
it('force-checks even a same-formula completed cache, retains its previous value and stays idempotent when checked again',()=>{
  const {study}=seed(), prepared=prepareQualityRepair(study,[oldDef],T+200*M), task=prepared.tasks[0];
  let next=applyQualityRepair(prepared.study,prepared.batch.id,task,resultFor(task),T+M);
  expect(next.campaignRuns).toHaveLength(1); expect(next.campaignRuns![0].priorResults![0].result.returnPct).toBe(-60);
  next=finishQualityRepair(next,prepared.batch.id,false,T+2*M);
  const again=prepareQualityRepair(next,[oldDef],T+300*M);
  const verified=applyQualityRepair(again.study,again.batch.id,again.tasks[0],resultFor(again.tasks[0]),T+3*M);
  expect(verified.campaignRuns).toHaveLength(1); expect(verified.campaignRuns![0].priorResults).toHaveLength(1);
  expect(verified.campaignRepair!.changedKeys).toHaveLength(0);
});
it('protects corrections from a stale full save while retaining unrelated catches and settings from the latest study',()=>{
  const {study}=seed(), prepared=prepareQualityRepair(study,[currentDef],T+200*M);
  const fixed=applyQualityRepair(prepared.study,prepared.batch.id,prepared.tasks[0],resultFor(prepared.tasks[0]),T+M);
  const unrelated={...study,tracking:false,samples:[...study.samples,{...study.samples[0],id:'new-catch'}]};
  const merged=preserveQualityRepairs(fixed,unrelated);
  expect(merged.tracking).toBe(false); expect(merged.samples.at(-1)!.id).toBe('new-catch');
  expect(qualityCampaignDataFromStudy('owner',merged,'sell')).toHaveLength(1);
  expect(merged.campaignRepair!.revision).toBe(fixed.campaignRepair!.revision);
  expect(merged.campaignRuns!.find(r=>!r.supersededBy)!.result.returnPct).toBe(-5);
});
it('chronologically reevaluates fresh market bars and never accepts an old complete result as proof',async()=>{
  const {study}=seed(), prepared=prepareQualityRepair(study,[currentDef],T+200*M), outcomes:QualityResult[]=[];
  const load=vi.fn(async(_row,from,cut,p)=>Array.from({length:(cut-from)/p.step},(_,i)=>{const t=from+i*p.step,close=p.step===M?100:80;return {openTime:t,open:p.step===M&&t===T+5*M?95:100,close,high:100,low:80,volume:1,quoteVolume:100,takerBuyQuoteVolume:50,takerBuyVolume:.5};}));
  await collectQualityRepair({tasks:prepared.tasks,signal:new AbortController().signal,onResult:async(_task,result)=>{outcomes.push(result);}},load,T+20*M);
  expect(load).toHaveBeenCalled(); expect(outcomes[0]).toMatchObject({status:'closed',endTime:T,endPrice:100,exitReading:.4}); expect(outcomes[0].returnPct).toBe(0);
  expect(definitionKey(currentDef)).not.toBe(definitionKey(oldDef));
});
it('replaces a same-formula close-confirmed campaign with the new timing identity and retains the prior alias chain',()=>{
 const seeded=seed(),plan={...seeded.plan,execution:undefined},row=seeded.row;
 const closed={...seeded.study.campaignRuns![0],plan,result:{...seeded.result,key:qualityResultKey(row,plan,0)}};
 const ancestor={...closed,result:{...closed.result,key:'original-wb1'},supersededBy:closed.result.key};
 const study={...seeded.study,sellPlans:[plan],campaignRuns:[ancestor,closed],results:[closed.result]};
 const prepared=prepareQualityRepair(syncQualitySellDefinitions(study,[oldDef]),[oldDef],T+200*M),task=prepared.tasks[0];
 expect(task.plan.execution).toBe('intrabar-1m');expect(task.key).not.toBe(closed.result.key);
 const next=applyQualityRepair(prepared.study,prepared.batch.id,task,{...closed.result,key:task.key},T+201*M);
 expect(next.campaignRepair!.changedKeys).toEqual([task.key]);
 const a=next.campaignRuns!.find(r=>r.result.key==='original-wb1')!,b=next.campaignRuns!.find(r=>r.result.key===a.supersededBy)!;
 expect(b.supersededBy).toBe(task.key);expect(next.campaignRuns!.find(r=>r.result.key===task.key)!.supersededBy).toBeUndefined();
 expect(qualityCampaignDataFromStudy('owner',next,'sell')).toHaveLength(1);
 const sheets=buildQualitySheets(next,[row]);
 expect(sheets[1].columns[32].header).toBe('卖出时机');expect(sheets[1].rows[0][32]).toBe('盘中达标 · 1分钟复原');
 expect(sheets[2].rows.some(r=>r[12]==='原周期收盘确认'&&r[13]==='盘中达标 · 1分钟复原')).toBe(true);
});

// 【用户要求】2026-10-26「停止纠错，把已经纠错过的保留，还未纠错的就不用纠错了，继续保持原样」
it('stops repairs: unfinished trades go back to their original results, verified ones keep the correction, and it is idempotent',()=>{
  const {study,result}=seed();
  const prepared=prepareQualityRepair(syncQualitySellDefinitions(study,[currentDef]),[currentDef],T+200*M);
  expect(qualityCampaignDataFromStudy('owner',prepared.study,'sell')).toHaveLength(0); // 待纠错时从板块上消失
  const stopped=stopQualityRepair(prepared.study,T+300*M);
  expect(stopped.campaignRepair).toMatchObject({state:'complete',revision:prepared.study.campaignRepair!.revision+1});
  expect(stopped.campaignRuns!.every(run=>!run.repair)).toBe(true);
  expect(stopped.results.map(r=>r.key)).toContain(result.key);
  const board=qualityCampaignDataFromStudy('owner',stopped,'sell');
  expect(board).toHaveLength(1); expect(board[0].campaign.final_realized_pnl).toBe(-60); // 原样
  expect(stopQualityRepair(stopped,T+400*M)).toBe(stopped);
  // 已纠错的保留
  const task=prepared.tasks[0], repaired=applyQualityRepair(prepared.study,prepared.batch.id,task,resultFor(task),T+201*M);
  const kept=stopQualityRepair(repaired,T+300*M);
  expect(qualityCampaignDataFromStudy('owner',kept,'sell').map(d=>d.campaign.final_realized_pnl)).toEqual([-5]);
  expect(kept.campaignRuns!.find(run=>run.result.key===task.key)!.repair?.status).toBe('verified');
  const fresh=seed().study; expect(stopQualityRepair(fresh,T)).toBe(fresh); // 没纠错过：原样
});
