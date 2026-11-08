import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { definitionKey } from '@/lib/deepDig/features';
import { collectPreEntryMonitor, type PreEntryRecord } from '../preEntryMonitor';
import { emptyPreEntryThreeStage, PRE_ENTRY_THREE_STAGE_V5, PRE_ENTRY_THREE_STAGE_VERSION, type EntryMarketCondition, type EntryMarketExpression } from '../preEntryThreeStage';
import { freezeQualityPlan,freezeSavedPlans,planVersionChanges } from '../qualityPlanVersions';
import type { QualityGroup } from '../quality';
import type { FishReconstructionLoader } from '../reconstruction';
import { withTuringInitialization } from '../qualityInitialization';

const mocked=vi.hoisted(()=>({events:[] as number[],broken:[] as number[]}));
vi.mock('../preEntryGuardEvent',async original=>{
  const actual=await original<typeof import('../preEntryGuardEvent')>();
  return {...actual,createPreEntryGuardReader:()=>async(at:number)=>({line:90,regime:'range',broken:mocked.broken.includes(at),event:mocked.events.includes(at)?{id:'event:'+at,at,kind:'raise',price:90,regime:'range',previousPrice:89,previousRegime:'range',boxId:'box',segment:0,broken:mocked.broken.includes(at),tickSize:'1',algorithmVersion:'dbl-5-v2',guardVersion:'dbl5-guard-v1',parameters:{},initializationStart:1,initializationId:'test',dataChecksum:'fixture'}:undefined})};
});
const M=60000,T=Date.UTC(2026,2,29,5);
const snapshot=(formula='raw=C',interval:'1m'|'5m'='1m')=>({featureId:'fixture',definitionKey:definitionKey({formula,positive:'1',control:'0',interval}),statistic:'raw',interval,scale:1,threshold:0,cutoffMs:T,average:0,cbi2:0,startAverage:0,previousAverage:0});
const condition=(id:string,threshold:number,direction:'<'|'>'='>',formula='raw=C'):EntryMarketCondition=>({id,label:id,metric:'raw',snapshot:snapshot(formula),enabled:true,direction,threshold,timing:'intrabar'});
const plan=():QualityGroup=>({id:'p',label:'三阶',metric:'raw',snapshot:snapshot(),preEntryThreeStage:emptyPreEntryThreeStage()});
const sample={id:'sample',enteredAt:T,basis:'signal' as const,importedAt:T,groups:[],source:{id:'source',symbol:'TURING:TURING 1',timeMs:T,timeLabel:'',fallbackZone:''}};
function loader(closes:number[]=Array(30).fill(100),zeroAt?:number):FishReconstructionLoader {
  return async(_row,from,to,p)=>Array.from({length:(to-from)/p.step},(_,i)=>{
    const openTime=from+i*p.step,k=Math.floor((openTime-T)/M),close=p.step===M&&k>=0?closes[k]??closes.at(-1)!:100,open=p.step===M&&k>0?closes[k-1]??closes.at(-1)!:100,volume=k===zeroAt?0:1;
    return {openTime,open,close,high:Math.max(open,close),low:Math.min(open,close),volume,quoteVolume:100*volume,takerBuyVolume:.5*volume,takerBuyQuoteVolume:50*volume};
  });
}
async function run(p:QualityGroup,options:{load?:FishReconstructionLoader;old?:PreEntryRecord;aborter?:AbortController;onRecord?:(r:PreEntryRecord)=>void;end?:number;hours?:number}={}){
  let record:PreEntryRecord=options.old??{id:'r',roundId:'round',planId:p.id,sample,status:'queued',startTime:T,cursor:T,readings:[],updatedAt:T};
  const aborter=options.aborter??new AbortController();
  try{await collectPreEntryMonitor({round:{id:'round',engine:PRE_ENTRY_THREE_STAGE_VERSION,plans:[freezeQualityPlan(p)],filters:[],hours:options.hours??0,state:'running',startedAt:T,updatedAt:T},records:[record],onRecord:r=>{record=r;options.onRecord?.(r);}},options.load??loader(),options.end??T+12*M,aborter.signal,vi.fn());}
  catch(error){if(!aborter.signal.aborted)throw error;}
  return record;
}
beforeEach(()=>{mocked.events=[T+5*M,T+10*M];mocked.broken=[];});
afterEach(()=>vi.restoreAllMocks());
it('admits only at the first native event when both exclusion tiers pass',async()=>{
  const p=plan();p.preEntryThreeStage!.required=[condition('price',90)];
  expect(await run(p)).toMatchObject({status:'matched',matchedAt:T+5*M,threeStage:{state:'matched',zero:{status:'pass'},first:{status:'pass'},second:{status:'pass'},event:{at:T+5*M}}});
});
it('does not latch early qualification or spend a vetoed event after recovery',async()=>{
  const p=plan();p.preEntryThreeStage!.required=[condition('price',105)];
  const r=await run(p,{load:loader([110,110,110,110,100,110,110,110,110,110])});
  expect(r).toMatchObject({status:'matched',matchedAt:T+10*M,missedGuard:{count:1,event:{at:T+5*M}}});
});
it('no new event means no admission even if all necessary conditions pass',async()=>{
  mocked.events=[];expect(await run(plan())).toMatchObject({status:'unmatched',threeStage:{state:'waiting-guard'}});
});
it('keeps an entire nested AND/OR seller and consecutive confirmation instead of flattening leaves',async()=>{
  const p=plan(),c=p.preEntryThreeStage!;
  const expression:EntryMarketExpression={join:'all',children:[{condition:condition('A',90)},{join:'any',children:[{condition:condition('B',110)},{condition:condition('C',120)}]}]};
  c.sellRules=[{id:'seller',label:'组合',enabled:true,expression,confirmation:{samples:2,minutes:1}}];
  // A true alone never vetoes. B/C false => the complete seller is false.
  expect(await run(p)).toMatchObject({status:'matched',matchedAt:T+5*M});
  // At the first event B has only just become true: one observation, not two.
  expect(await run(p,{load:loader([100,100,100,100,115,115])})).toMatchObject({matchedAt:T+5*M});
  // Two consecutive confirmations complete the seller and block that event.
  const r=await run(p,{load:loader([115,115,115,115,115,100,100,100,100,100])});
  expect(r).toMatchObject({matchedAt:T+10*M,missedGuard:{count:1,reason:expect.stringContaining("② 排除门槛")}});
});
it('hard vetoes win without waiting for an ordinary seller confirmation',async()=>{
  const p=plan();p.preEntryThreeStage!.hardVetoes=[{id:'drop',kind:'drop-1m',label:'急跌',enabled:true,direction:'>=',threshold:5}];
  const r=await run(p,{load:loader([100,100,100,100,90,100,100,100,100,100])});
  expect(r).toMatchObject({matchedAt:T+10*M,missedGuard:{count:1,reason:expect.stringContaining("② 排除门槛")}});
});
it('keeps historical fast-drop locks after a new native line appears',async()=>{
  const p=plan();p.preEntryThreeStage!.additionVetoes=[{kind:'fast-drop',enabled:true,windows:[{minutes:1,pct:5}]}];
  expect(await run(p,{load:loader([100,90,100,100,100,100,100,100,100,100])})).toMatchObject({status:'unmatched',missedGuard:{count:2},threeStage:{second:{status:'blocked'}}});
});
it('new guard events cannot clear two-drop locks before the original 5m recovery close',async()=>{
  mocked.events=[T+20*M,T+25*M,T+30*M];
  const p=plan();p.preEntryThreeStage!.additionVetoes=[{kind:'double-drop',enabled:true,pct:4}];
  const closes=[100,95,97,95,99,100];
  const load:FishReconstructionLoader=async(_row,from,to,program)=>Array.from({length:(to-from)/program.step},(_,i)=>{
    const at=from+i*program.step,k=Math.floor((at-T)/(5*M)),a=k<=0?100:closes[k-1]??100,b=k<0?100:closes[k]??100,n=((at-T)/M-k*5);
    const open=program.step===5*M?a:a+(b-a)*n/5,close=program.step===5*M?b:a+(b-a)*(n+1)/5;
    return {openTime:at,open,close,high:Math.max(open,close),low:Math.min(open,close),volume:1,quoteVolume:100,takerBuyVolume:.5,takerBuyQuoteVolume:50};
  });
  const result=await run(p,{load,end:T+31*M});
  expect(result).toMatchObject({status:'matched',matchedAt:T+30*M,missedGuard:{count:2},lastVeto:{reason:expect.stringContaining('二次急跌')}});
});
it('unknown initialized seller data is pending, never an implicitly clear veto',async()=>{
  const p=plan();p.initialization='turing-origin-v1';
  p.preEntryThreeStage!.sellRules=[{id:'late',label:'晚预热',enabled:true,expression:{condition:condition('prev',200,'>','raw=sma(C,30)')},confirmation:{samples:1,minutes:1}}];
  let record:PreEntryRecord={id:'r',roundId:'round',planId:p.id,sample,status:'queued',startTime:T,cursor:T,readings:[],updatedAt:T};
  await collectPreEntryMonitor({round:{id:'round',engine:PRE_ENTRY_THREE_STAGE_VERSION,plans:[freezeQualityPlan(p)],filters:[],hours:0,state:'running',startedAt:T,updatedAt:T},records:[record],onRecord:r=>record=r},loader(),T+12*M,new AbortController().signal,vi.fn(),{start:async()=>T});
  expect(record).toMatchObject({status:'unmatched',threeStage:{state:'waiting-data'},missedGuard:{count:2}});
});
it('waits through a valid zero-trade event and never later reuses that missed event',async()=>{
  const r=await run(plan(),{load:loader(undefined,4)});
  expect(r).toMatchObject({status:'matched',matchedAt:T+10*M,zeroTradeWait:{count:1},missedGuard:{count:1}});
});
it('stops on a real missing minute and cannot put an error into the admission library',async()=>{
  const load=loader(),r=await run(plan(),{load:async(...args)=>(await load(...args)).filter(b=>b.openTime!==T+2*M)});
  expect(r.status).toBe('error');expect(r.matchedAt).toBeUndefined();
});
it('an unobserved later market gap cannot hide an earlier valid event',async()=>{
  const p=plan(),load=loader(),old:PreEntryRecord={id:'r',roundId:'round',planId:p.id,sample:{...sample,source:{...sample.source,symbol:'TESTUSDT'}},status:'queued',startTime:T,cursor:T,readings:[],updatedAt:T};
  const result=await run(p,{old,load:async(...args)=>(await load(...args)).filter(b=>b.openTime!==T+8*M)});
  expect(result).toMatchObject({status:'matched',matchedAt:T+5*M});
});
it('preserves closed-original detector thresholds and rejects a missing selected detector',async()=>{
  const p=plan();p.preEntryThreeStage!.detectors=[{id:'d',stricterPct:10,match:'all'}];
  const original={...snapshot(),threshold:90,direction:'>' as const};
  const old:PreEntryRecord={id:'r',roundId:'round',planId:p.id,sample:{...sample,readings:{detector:original}},status:'queued',startTime:T,cursor:T,readings:[],updatedAt:T};
  expect(await run(p,{old})).toMatchObject({matchedAt:T+5*M});
  p.preEntryThreeStage!.detectors[0].featureId='absent';
  expect(await run(p,{old})).toMatchObject({status:'unmatched',threeStage:{zero:{status:'blocked',reason:expect.stringContaining('没有所选')}}});
});
it('resumes with identical admission evidence and without duplicating missed events or veto counts',async()=>{
  let clock=0;vi.spyOn(performance,'now').mockImplementation(()=>clock+=200);
  const p=plan();p.preEntryThreeStage!.required=[condition('price',105)];
  const load=loader([110,110,110,110,100,110,110,110,110,110]),aborter=new AbortController();
  const paused=await run(p,{load,aborter,onRecord:r=>{if(r.status==='scanning'&&r.cursor===T+6*M)aborter.abort();}});
  expect(paused.status).toBe('paused');
  const resumed=await run(p,{load,old:paused}),whole=await run(p,{load});
  expect(resumed.matchedAt).toBe(whole.matchedAt);expect(resumed.threeStage).toEqual(whole.threeStage);
  expect(resumed.missedGuard).toEqual(whole.missedGuard);expect(resumed.lastVeto).toEqual(whole.lastVeto);
});

it('retains frozen v5 plan identities and flags an explicit version replacement instead of upgrading it silently',()=>{
 const p=plan();p.preEntryThreeStage!.version=PRE_ENTRY_THREE_STAGE_V5;const saved=freezeQualityPlan(p),before=structuredClone(saved);
 expect(saved.frozenVersions!.find(v=>v.key==='pre-entry-three-stage')!.version).toMatch(/^pre-entry-three-stage-v5 · 参数 #/);
 expect(planVersionChanges(JSON.parse(JSON.stringify(saved)))).toEqual([]);expect(freezeSavedPlans([saved],[structuredClone(saved)])[0]).toEqual(before);
 const changed=structuredClone(saved);changed.preEntryThreeStage!.version=PRE_ENTRY_THREE_STAGE_VERSION;expect(planVersionChanges(changed).map(c=>c.key)).toContain('pre-entry-three-stage');expect(saved).toEqual(before);
});
it('runs saved v5 evidence with the original stage meanings while v6 records the reordered stages',async()=>{
 const old=plan();old.preEntryThreeStage!.version=PRE_ENTRY_THREE_STAGE_V5;old.preEntryThreeStage!.required=[condition('price',90)];const before=structuredClone(old);
 const v5=await run(old),copy=structuredClone(old);copy.preEntryThreeStage!.version=PRE_ENTRY_THREE_STAGE_VERSION;const v6=await run(copy);
 expect(v5.matchedAt).toBe(v6.matchedAt);expect(v5.threeStage).toMatchObject({first:{status:'pass'},second:{status:'pass'},third:{status:'pass'}});expect(v5.threeStage!.zero).toBeUndefined();expect(v6.threeStage).toMatchObject({zero:{status:'pass'},first:{status:'pass'},second:{status:'pass'}});expect(old).toEqual(before);
});
it('preserves v5 pause/resume evidence and the original veto reasons without moving gates to the new stages',async()=>{
 let clock=0;vi.spyOn(performance,'now').mockImplementation(()=>clock+=200);const p=plan();p.preEntryThreeStage!.version=PRE_ENTRY_THREE_STAGE_V5;p.preEntryThreeStage!.required=[condition('price',105)];
 const load=loader([110,110,110,110,100,110,110,110,110,110]),aborter=new AbortController();const paused=await run(p,{load,aborter,onRecord:r=>{if(r.status==='scanning'&&r.cursor===T+6*M)aborter.abort();}});
 const resumed=await run(p,{load,old:paused}),whole=await run(p,{load});expect(resumed.matchedAt).toBe(whole.matchedAt);expect(resumed.threeStage).toEqual(whole.threeStage);expect(resumed.lastVeto).toEqual(whole.lastVeto);expect(resumed.missedGuard).toEqual(whole.missedGuard);expect(whole.missedGuard!.reason).toContain('一阶排除');
});

it('stops at the first admitted time and never advances its cursor to the configured deadline',async()=>{
 const trace:PreEntryRecord[]=[];
 const r=await run(plan(),{hours:48,end:T+72*60*M,onRecord:r=>trace.push(structuredClone(r))});
 expect(r).toMatchObject({status:'matched',matchedAt:T+5*M,cursor:T+5*M,endTime:T+48*60*M});
 expect(trace.at(-1)?.cursor).toBe(T+5*M);
 expect(trace.filter(r=>r.status==='matched')).toHaveLength(1);
});
it('finishes an unqualified symbol at exactly 48 hours despite later events and longer available history',async()=>{
 mocked.events=[T+49*60*M];
 const r=await run(plan(),{hours:48,end:T+72*60*M});
 expect(r).toMatchObject({status:'unmatched',cursor:T+48*60*M,endTime:T+48*60*M});
 expect(r.matchedAt).toBeUndefined();
});
it('uses a custom per-symbol limit and accepts a first match exactly at its deadline',async()=>{
 mocked.events=[T+60*M];
 expect(await run(plan(),{hours:1,end:T+72*60*M})).toMatchObject({status:'matched',matchedAt:T+60*M,cursor:T+60*M});
 mocked.events=[T+65*M];
 expect(await run(plan(),{hours:1,end:T+72*60*M})).toMatchObject({status:'unmatched',cursor:T+60*M});
});
