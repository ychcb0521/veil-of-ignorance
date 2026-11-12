import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { definitionKey } from '@/lib/deepDig/features';
import { collectPreEntryMonitor, preEntrySignal, type PreEntryRecord } from '../preEntryMonitor';
import { emptyPreEntryThreeStage, retryPreEntryThreeStage, signalGatePreEntryThreeStage, trackedGatePreEntryThreeStage, optionalStagesPreEntryThreeStage, signalAnchoredPreEntryThreeStage, PRE_ENTRY_RETRY_VERSION, PRE_ENTRY_THREE_STAGE_V5, PRE_ENTRY_THREE_STAGE_VERSION, type EntryMarketCondition, type EntryMarketExpression } from '../preEntryThreeStage';
import { freezeQualityPlan,freezeSavedPlans,planVersionChanges } from '../qualityPlanVersions';
import type { QualityGroup } from '../quality';
import type { FishReconstructionLoader } from '../reconstruction';
import { withTuringInitialization } from '../qualityInitialization';
import { defaultEntryStallTurn } from '../preEntryStallTurn';
import { sample as dblBars } from '@/lib/__tests__/fixtures/dblBars';
import { ADDITION_VETO_DEFAULTS, guardDistanceConfig } from '../qualityAdditionVeto';

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
async function run(p:QualityGroup,options:{load?:FishReconstructionLoader;old?:PreEntryRecord;aborter?:AbortController;onRecord?:(r:PreEntryRecord)=>void;end?:number;hours?:number;start?:number;automatic?:boolean}={}){
  let record:PreEntryRecord=options.old??{id:'r',roundId:'round',planId:p.id,sample,status:'queued',startTime:T,cursor:T,readings:[],updatedAt:T};
  const aborter=options.aborter??new AbortController();
  const retry=p.preEntryThreeStage?.observationBasis==='retry-origin-v2';
  try{await collectPreEntryMonitor({round:{id:'round',engine:retry?p.preEntryThreeStage!.version:PRE_ENTRY_THREE_STAGE_VERSION,plans:[freezeQualityPlan(p)],filters:[],hours:options.hours??(retry?1:0),state:'running',startedAt:T,updatedAt:T,automatic:options.automatic},records:[record],onRecord:r=>{record=r;options.onRecord?.(r);}},options.load??loader(),options.end??T+12*M,aborter.signal,vi.fn(),options.start==null?undefined:{start:async()=>options.start});}
  catch(error){if(!aborter.signal.aborted)throw error;}
  return record;
}
beforeEach(()=>{mocked.events=[T+5*M,T+10*M];mocked.broken=[];});
function retryPlan(){const p=plan();p.preEntryThreeStage=retryPreEntryThreeStage(p.preEntryThreeStage!);return p;}
function stateOnlyPlan(){const p=retryPlan();p.preEntryThreeStage!.admission={guardEnabled:false,algorithms:[condition('状态 S',.8,'>','raw=C/100')]};return p;}
it('keeps an automatic catch queued at the live boundary and admits on the later closed minute',async()=>{
 const p=stateOnlyPlan();
 p.preEntryThreeStage=signalGatePreEntryThreeStage(p.preEntryThreeStage!);
 p.preEntryThreeStage.required=[condition('信号资格',95)];
 const load=loader([75,90]);
 const first=await run(p,{automatic:true,end:T+M,load});
 expect(first).toMatchObject({status:'queued',cursor:T+M,endTime:T+M,signalGate:{status:'pass'}});
 const resumed=await run(p,{automatic:true,end:T+2*M,load,old:first});
 expect(resumed).toMatchObject({status:'matched',matchedAt:T+2*M,signalGate:first.signalGate});
 expect((await run(p,{end:T+M,load})).status).toBe('unmatched');
});
it('ends an automatic catch at the frozen deadline and ignores later opportunities',async()=>{
 const p=stateOnlyPlan();
 p.preEntryThreeStage=signalGatePreEntryThreeStage(p.preEntryThreeStage!);
 const load=loader([75,75,90]);
 const first=await run(p,{automatic:true,end:T+M,hours:2/60,load});
 expect(first.status).toBe('queued');
 expect(await run(p,{automatic:true,end:T+3*M,hours:2/60,load,old:first})).toMatchObject({status:'unmatched',cursor:T+2*M});
});
it('retains a passing signal-time gate across later price changes, a veto and resumption',async()=>{
 const original=stateOnlyPlan();
 original.preEntryThreeStage!.required=[condition('必要条件',95)];
 original.preEntryThreeStage!.longDrawdown={enabled:true,mode:'current',hours:1/60,pct:6};
 const frozen=freezeQualityPlan(original);
 const next={...original,preEntryThreeStage:signalGatePreEntryThreeStage(original.preEntryThreeStage!)};
 const load=loader([90,90,75,90]);
 let clock=0;vi.spyOn(performance,'now').mockImplementation(()=>clock+=200);
 const aborter=new AbortController();
 const paused=await run(next,{load,aborter,onRecord:r=>{if(r.status==='scanning'&&r.cursor===T+M)aborter.abort();}});
 expect(paused.status).toBe('paused');
 expect(paused.signalGate).toMatchObject({signalAt:T,at:T,status:'pass',readings:[{value:100,met:true}]});
 const resumed=await run(next,{load,old:paused});
 expect(resumed).toMatchObject({status:'matched',matchedAt:T+4*M,signalGate:paused.signalGate});
 expect(resumed.exclusionProcess!.entries.some(e=>e.kind==='restart')).toBe(true);
 expect((await run(frozen,{load})).status).toBe('unmatched');
 expect(planVersionChanges(frozen)).toEqual([]);
});
it('does not run the historical window or restart until a new event produces a candidate',async()=>{
 const p=stateOnlyPlan();
 p.preEntryThreeStage=signalGatePreEntryThreeStage(p.preEntryThreeStage!);
 p.preEntryThreeStage.admission!.algorithms=[condition('准入',120)];
 p.preEntryThreeStage.longDrawdown={enabled:true,mode:'maximum',hours:1,pct:3};
 const load=vi.fn(loader([90,70,80]));
 const result=await run(p,{load});
 expect(result).toMatchObject({status:'unmatched',retry:{attempt:1}});
 expect(result.lastVeto).toBeUndefined();
 expect(load.mock.calls.some(([, , , program])=>program.def.id==='pre-entry-long-drawdown')).toBe(false);
});
it.each(['indicator','drop-1m'] as const)('checks a historical %s trigger at the candidate, then finds a later fresh event',async kind=>{
 const p=stateOnlyPlan();
 p.preEntryThreeStage=signalGatePreEntryThreeStage(p.preEntryThreeStage!);
 p.preEntryThreeStage.admission!.algorithms=[condition('准入',100)];
 p.preEntryThreeStage.hardVetoes=[kind==='indicator'
   ?{id:'hard',label:'历史硬伤',enabled:true,kind,metric:'raw',snapshot:snapshot(),direction:'<',threshold:90}
   :{id:'hard',label:'历史硬伤',enabled:true,kind,direction:'>=',threshold:12}];
 const result=await run(p,{load:loader([85,105,105,95,105])});
 expect(result).toMatchObject({status:'matched',matchedAt:T+5*M,lastVeto:{at:T+2*M,reason:expect.stringMatching(/历史硬伤.*历史触发于/)}});
 expect(result.exclusionProcess!.entries.filter(e=>e.kind==='restart')).toHaveLength(1);
 expect(result.exclusionProcess!.entries.find(e=>e.stage==='exclusion')?.admission).toEqual({at:T+2*M,labels:['准入'],indicatorIds:['准入']});
});
it('rejects at the original signal time without borrowing stronger readings from the later screening start',async()=>{
 const p=stateOnlyPlan();
 p.preEntryThreeStage=signalGatePreEntryThreeStage(p.preEntryThreeStage!);
 p.preEntryThreeStage.required=[condition('必要条件',105)];
 const old:PreEntryRecord={id:'r',roundId:'round',planId:p.id,sample:{...sample,source:{...sample.source,timeMs:T+19_000}},status:'queued',startTime:T+M,cursor:T+M,readings:[],updatedAt:T};
 const load=vi.fn(loader([120,120]));
 const result=await run(p,{load,old});
 expect(result).toMatchObject({status:'unmatched',signalGate:{signalAt:T+19_000,at:T,status:'blocked',readings:[{value:100,met:false}]}});
 expect(load.mock.calls.every(([, , cutoff])=>cutoff<=T)).toBe(true);
});
it('keeps selected candle timing at the signal, including the partial 5m candle built from closed minutes',async()=>{
 const p=stateOnlyPlan();
 p.preEntryThreeStage=signalGatePreEntryThreeStage(p.preEntryThreeStage!);
 p.preEntryThreeStage.required=['intrabar','closed'].map((timing,i)=>({
   ...condition(timing,i===0?105:95),snapshot:snapshot('raw=C','5m'),timing:timing as EntryMarketCondition['timing'],
 }));
 const old:PreEntryRecord={id:'r',roundId:'round',planId:p.id,sample:{...sample,source:{...sample.source,timeMs:T+2*M}},status:'queued',startTime:T+2*M,cursor:T+2*M,readings:[],updatedAt:T};
 const result=await run(p,{old,load:loader([110,120,90])});
 expect(result.signalGate).toMatchObject({status:'pass',readings:[{id:'intrabar',value:120},{id:'closed',value:100}]});
 expect(result.status).toBe('matched');
});
it('uses only closed 5m bars through v7 retries and resume, admitting on the exact recovery close',async()=>{
 const p=stateOnlyPlan();p.preEntryThreeStage!.additionVetoes=[{...ADDITION_VETO_DEFAULTS['stall-turn'],enabled:true}];
 const closes=[101,102,103,104,105,106,107,108,109,110,111,112,112,112,112,111,110],price=(i:number)=>i < -17?100:i<0?closes[i+17]:i===0?111:112;
 const load:FishReconstructionLoader=async(_r,a,b,program)=>Array.from({length:(b-a)/program.step},(_,i)=>{const openTime=a+i*program.step,k=(openTime-T)/(5*M),open=program.step===M?120:price(k-1),close=program.step===M?120:price(k);return {openTime,open,close,high:Math.max(open,close),low:Math.min(open,close),volume:1,takerBuyVolume:.5};});
 let clock=0;vi.spyOn(performance,'now').mockImplementation(()=>clock+=200);
 const aborter=new AbortController(),paused=await run(p,{load,aborter,onRecord:r=>{if(r.status==='scanning'&&r.cursor===T+7*M)aborter.abort();}});
 expect(paused.status).toBe('paused');expect(paused.threeStage?.second.reason).toContain('滞涨转弱·5分钟');
 const resumed=await run(p,{load,old:paused}),whole=await run(p,{load});expect(resumed.matchedAt).toBe(T+10*M);expect(resumed.matchedAt).toBe(whole.matchedAt);
 expect(resumed.exclusionProcess!.entries.filter(e=>e.kind!=='paused')).toEqual(whole.exclusionProcess!.entries);
 expect(JSON.stringify(whole.exclusionProcess)).toContain('滞涨转弱');
});
it('retains the stall-turn veto through state-only retries and resume, then admits only after local recovery',async()=>{
 const p=stateOnlyPlan();p.preEntryThreeStage!.stallTurn={...defaultEntryStallTurn(),pullback:undefined,historyHours:1/12,riseMinutes:5,risePct:3,stallMinutes:4,turnMinutes:2};
 const prices=[101,102,103,104,105,105,105,105,105,104,103],price=(k:number)=>k < -12?100:k<=-2?prices[k+12]:k>=3?Math.min(106,104+k-3):103;
 const load:FishReconstructionLoader=async(_row,from,to,p)=>Array.from({length:(to-from)/p.step},(_,i)=>{const openTime=from+i*p.step,k=(openTime-T)/M,open=price(k-1),close=price(k);return {openTime,open,close,high:Math.max(open,close),low:Math.min(open,close),volume:1,takerBuyVolume:.5};});
 let clock=0;vi.spyOn(performance,'now').mockImplementation(()=>clock+=200);
 const aborter=new AbortController(),paused=await run(p,{load,aborter,onRecord:r=>{if(r.status==='scanning'&&r.cursor===T+3*M)aborter.abort();}});
 expect(paused.status).toBe('paused');expect(paused.threeStage).toMatchObject({first:{status:'pass'},second:{status:'blocked',reason:expect.stringContaining('滞涨转弱')}});
 const resumed=await run(p,{load,old:paused}),whole=await run(p,{load});expect(resumed.matchedAt).toBe(T+5*M);expect(resumed.matchedAt).toBe(whole.matchedAt);
 expect(resumed.exclusionProcess!.entries.filter(e=>e.kind!=='paused')).toEqual(whole.exclusionProcess!.entries);
 expect(whole.exclusionProcess!.entries.some(e=>e.readings?.some(r=>r.id==='entry-stall-turn-v1'&&r.met))).toBe(true);
 const disabled=structuredClone(p);disabled.preEntryThreeStage!.stallTurn!.enabled=false;expect((await run(disabled,{load})).matchedAt).toBe(T+M);
});
it('keeps the severe-pullback high through retries and resume until a new completed closing high',async()=>{
 const p=stateOnlyPlan();p.preEntryThreeStage!.stallTurn={...defaultEntryStallTurn(),historyHours:1/12,riseMinutes:5,risePct:50,stallMinutes:4,turnMinutes:2};
 const price=(k:number)=>k < -2?100:k<0?96:k<8?96+k*.5:k===8?100:101;
 const load:FishReconstructionLoader=async(_row,from,to,p)=>Array.from({length:(to-from)/p.step},(_,i)=>{const openTime=from+i*p.step,k=(openTime-T)/M,open=price(k-1),close=price(k);return {openTime,open,close,high:Math.max(open,close),low:Math.min(open,close),volume:1,takerBuyVolume:.5};});
 let clock=0;vi.spyOn(performance,'now').mockImplementation(()=>clock+=200);
 const aborter=new AbortController(),paused=await run(p,{load,aborter,onRecord:r=>{if(r.status==='scanning'&&r.cursor===T+7*M)aborter.abort();}});
 expect(paused.status).toBe('paused');expect(paused.threeStage?.second.reason).toContain('猛烈回调未创新高');expect(paused.threeStage?.attempt!.index).toBeGreaterThan(1);
 const resumed=await run(p,{load,old:paused}),whole=await run(p,{load});expect(resumed.matchedAt).toBe(T+10*M);expect(resumed.matchedAt).toBe(whole.matchedAt);
 expect(resumed.exclusionProcess!.entries.filter(e=>e.kind!=='paused')).toEqual(whole.exclusionProcess!.entries);
 expect(whole.exclusionProcess!.entries.some(e=>e.readings?.some(r=>r.id.endsWith(':peak-lock')&&r.threshold===100))).toBe(true);
});
it('state-only screening rejects pre-start damage through repeated retries and deterministic resume only in the selected history scope',async()=>{
 const p=stateOnlyPlan();p.preEntryThreeStage!.additionVetoes=[{kind:'pullback',enabled:true,pct:10,sticky:true,historyHours:6}];
 const base=loader([100]),load:FishReconstructionLoader=async(...args)=>(await base(...args)).map(b=>args[3].step===5*M&&b.openTime===T-2*60*M?{...b,high:150}:b);
 const result=await run(p,{load});expect(result.status).toBe('unmatched');expect(result.threeStage?.second.reason).toContain('150');expect(result.threeStage?.attempt!.index).toBeGreaterThan(1);
 const old=structuredClone(p);delete old.preEntryThreeStage!.additionVetoes[0].historyHours;expect((await run(old,{load})).status).toBe('matched');
});
it('state-only admission cannot bypass an enabled lower-wick veto on the last completed 5m candle',async()=>{
 const p=stateOnlyPlan();p.preEntryThreeStage!.additionVetoes=[{kind:'lower-wick',enabled:true,lookbackBars:1,atr:1,ratio:60}];
 const base=loader([90]),load:FishReconstructionLoader=async(...args)=>(await base(...args)).map(b=>args[3].step===5*M&&b.openTime===T-5*M?{...b,low:70}:b);
 expect(await run(p,{load,end:T+M})).toMatchObject({status:'unmatched',threeStage:{first:{status:'pass'},second:{status:'blocked',reason:expect.stringContaining('长下影线')},admission:{met:['状态 S']}}});
});
it.each(['necessary','addition-veto','ordinary-seller','indicator-hard-stop','price-hard-stop','long-drawdown'] as const)('state-only admission still enforces %s at the same minute',async kind=>{
 const p=stateOnlyPlan(),c=p.preEntryThreeStage!;
 if(kind==='necessary')c.required=[condition('必要条件',1,'>','raw=C/100')];
 if(kind==='addition-veto')c.additionVetoes=[{kind:'fast-drop',enabled:true,windows:[{minutes:1,pct:5}]}];
 if(kind==='ordinary-seller')c.sellRules=[{id:'seller',label:'普通卖出',enabled:true,expression:{condition:condition('卖出条件',.85,'>','raw=C/100')},confirmation:{samples:1,minutes:1}}];
 if(kind==='indicator-hard-stop')c.hardVetoes=[{id:'hard',kind:'indicator',label:'指标硬性终止',enabled:true,direction:'>=',threshold:.85,metric:'raw',snapshot:snapshot('raw=C/100')}];
 if(kind==='price-hard-stop')c.hardVetoes=[{id:'hard',kind:'drop-1m',label:'一分钟急跌',enabled:true,direction:'>=',threshold:5}];
 if(kind==='long-drawdown')c.longDrawdown={enabled:true,hours:.1,pct:10,mode:'current'};
 const before=structuredClone(p),base=loader([90]),load:FishReconstructionLoader=async(...args)=>(await base(...args)).map(b=>kind==='long-drawdown'&&b.openTime===T-2*M?{...b,high:200}:b);
 const result=await run(p,{load,end:T+M});
 expect(result.status).toBe('unmatched');expect(result.matchedAt).toBeUndefined();
 expect(result.threeStage).toMatchObject({first:{status:'pass'},admission:{met:['状态 S']},[kind==='necessary'?'zero':'second']:{status:'blocked'}});
 expect(result.threeStage!.event).toBeUndefined();expect(result.exclusionProcess!.entries.some(e=>e.status==='blocked')).toBe(true);expect(p).toEqual(before);
});
it('state-only admission passes when exclusions are off, but a triggered veto blocks that minute before a later retry',async()=>{
 const p=stateOnlyPlan(),load=loader([90,90,90]);expect(await run(p,{load})).toMatchObject({status:'matched',matchedAt:T+M,threeStage:{second:{status:'pass'}}});
 p.preEntryThreeStage!.additionVetoes=[{kind:'fast-drop',enabled:true,windows:[{minutes:1,pct:5}]}];
 const result=await run(p,{load});expect(result).toMatchObject({status:'matched',matchedAt:T+2*M,retry:{attempt:2,startedAt:T+M},lastVeto:{at:T+M,reason:expect.stringContaining('急跌')}});
 expect(result.exclusionProcess!.entries.some(e=>e.status==='blocked'&&e.through===T+M)).toBe(true);
});
it('state-only admission preserves ordinary seller consecutive confirmations and never waits for them to apply a hard stop',async()=>{
 const p=stateOnlyPlan(),c=p.preEntryThreeStage!;
 c.sellRules=[{id:'seller',label:'两次确认卖出',enabled:true,expression:{condition:condition('卖出条件',.7,'>','raw=C/100')},confirmation:{samples:2,minutes:1}}];
 const confirmed=await run(p,{load:loader([79,90]),end:T+2*M});expect(confirmed).toMatchObject({status:'unmatched',threeStage:{first:{status:'pass'},second:{status:'blocked',reason:'两次确认卖出 完整成立'}}});
 c.hardVetoes=[{id:'hard',kind:'drop-1m',label:'一分钟急跌',enabled:true,direction:'>=',threshold:5}];
 const immediate=await run(p,{load:loader([90]),end:T+M});expect(immediate).toMatchObject({status:'unmatched',threeStage:{first:{status:'pass'},second:{status:'blocked',reason:expect.stringContaining('一分钟急跌')}}});
});
it('v7 optional long-window drawdown cannot be cleared by restarting the local origin',async()=>{
 const p=retryPlan();p.preEntryThreeStage!.admission!.algorithms=[condition('状态 S',.8,'>','raw=C/100')];expect(await run(p)).toMatchObject({matchedAt:T+M});
 p.preEntryThreeStage!.longDrawdown={enabled:true,hours:.1,pct:10,mode:'current'};const base=loader(),load:FishReconstructionLoader=async(...args)=>(await base(...args)).map(b=>b.openTime===T-2*M?{...b,high:200}:b);
 const result=await run(p,{load});expect(result).toMatchObject({matchedAt:T+5*M,retry:{attempt:5,startedAt:T+4*M}});expect(result.exclusionProcess!.entries.some(e=>e.reason.includes('长周期回撤否决'))).toBe(true);
});
it('v7 does not wait for every OR algorithm to finish warming up before admitting a valid native event',async()=>{
 const p=retryPlan();p.preEntryThreeStage!.admission!.algorithms=[condition('慢预热',.8,'>','raw=sma(C,300)')];const load=vi.fn(loader());
 const result=await run(p,{start:T,load});expect(result).toMatchObject({status:'matched',matchedAt:T+5*M,threeStage:{admission:{met:['原生防守线新事件']}}});
 expect(load.mock.calls.some(call=>call[3].def?.id==='fixture')).toBe(false);
});
it('v7 restarts the observation after a fast-drop veto while v6 keeps its original historical lock',async()=>{
 const old=plan();old.preEntryThreeStage!.additionVetoes=[{kind:'fast-drop',enabled:true,windows:[{minutes:1,pct:5}]}];const before=structuredClone(old),next={...structuredClone(old),preEntryThreeStage:retryPreEntryThreeStage(old.preEntryThreeStage!)};
 const load=loader([100,90,100,100,100,100,100,100,100,100]);
 expect(await run(old,{load,hours:1})).toMatchObject({status:'unmatched',threeStage:{second:{status:'blocked'}}});
 const result=await run(next,{load});expect(result).toMatchObject({status:'matched',matchedAt:T+5*M,retry:{attempt:2,startedAt:T+2*M},threeStage:{attempt:{index:2,startedAt:T+2*M}}});
 expect(result.exclusionProcess!.entries.filter(e=>e.kind==='restart')).toHaveLength(1);expect(old).toEqual(before);
});
it('v7 OR admission accepts a state threshold without a native event, and rejects the exact threshold for a strict greater-than rule',async()=>{
 mocked.events=[];const p=retryPlan();p.preEntryThreeStage!.admission!.algorithms=[condition('状态 S',.8,'>','raw=C/100'),condition('另一算法',2,'>','raw=C/100')];
 const result=await run(p,{load:loader([79,80,81,81])});expect(result).toMatchObject({status:'matched',matchedAt:T+3*M,threeStage:{admission:{join:'any',met:['状态 S']}}});expect(result.threeStage!.event).toBeUndefined();
});
it('v7 native guard admission still works when every parallel algorithm is false, and can be disabled independently',async()=>{
 const p=retryPlan();p.preEntryThreeStage!.admission!.algorithms=[condition('状态 S',2,'>','raw=C/100')];
 expect(await run(p)).toMatchObject({status:'matched',matchedAt:T+5*M,threeStage:{admission:{met:['原生防守线新事件']}}});
 p.preEntryThreeStage!.admission!.guardEnabled=false;expect(await run(p)).toMatchObject({status:'unmatched'});
});
it('v7 parallel admission cannot bypass required conditions or hard vetoes and cannot reuse an earlier guard event',async()=>{
 const p=retryPlan();p.preEntryThreeStage!.required=[condition('必要条件',105)];
 const result=await run(p,{load:loader([100,100,100,100,100,110,110,110,110,110])});expect(result).toMatchObject({matchedAt:T+10*M,missedGuard:{count:1,event:{at:T+5*M}}});
 p.preEntryThreeStage!.admission!.algorithms=[condition('状态 S',.8,'>','raw=C/100')];p.preEntryThreeStage!.hardVetoes=[{id:'hard',kind:'indicator',label:'硬性否决',enabled:true,direction:'>=',threshold:.8,metric:'raw',snapshot:snapshot('raw=C/100')}];
 expect(await run(p,{load:loader(Array(20).fill(110))})).toMatchObject({status:'unmatched',threeStage:{second:{status:'blocked'}}});
});
it('v7 never extends the original total deadline when repeatedly rebuilding the origin',async()=>{
 mocked.events=[T+7*M];const p=retryPlan();p.preEntryThreeStage!.required=[condition('必要条件',105)];
 const result=await run(p,{hours:.1,end:T+20*M,load:loader([100,100,100,100,100,100,110,110])});expect(result).toMatchObject({status:'unmatched',cursor:T+6*M,endTime:T+6*M});
 expect(result.exclusionProcess!.entries.filter(e=>e.kind==='restart')).toHaveLength(5);expect(result.matchedAt).toBeUndefined();
});
it('v7 reconstructs attempts on resume without duplicate restarts or reused native events',async()=>{
 let clock=0;vi.spyOn(performance,'now').mockImplementation(()=>clock+=200);const p=retryPlan();p.preEntryThreeStage!.additionVetoes=[{kind:'fast-drop',enabled:true,windows:[{minutes:1,pct:5}]}];
 const load=loader([100,90,100,100,100,100,100,100,100,100]),aborter=new AbortController();
 const paused=await run(p,{load,aborter,onRecord:r=>{if(r.status==='scanning'&&r.cursor===T+3*M)aborter.abort();}}),saved=structuredClone(paused);
 const resumed=await run(p,{load,old:paused}),whole=await run(p,{load});expect(resumed.matchedAt).toBe(whole.matchedAt);expect(resumed.retry).toEqual(whole.retry);expect(resumed.exclusionProcess!.entries.filter(e=>e.kind!=='paused')).toEqual(whole.exclusionProcess!.entries);expect(paused).toEqual(saved);
});
it('v7 keeps zero-trade data pending instead of resetting observations to evade missing readings',async()=>{
 const p=retryPlan(),r=await run(p,{load:loader(undefined,4)});expect(r).toMatchObject({matchedAt:T+10*M,retry:{attempt:1,startedAt:T},missedGuard:{count:1}});expect(r.exclusionProcess!.entries.some(e=>e.kind==='restart')).toBe(false);
});
it('v7 reuses market histories during repeated rejections instead of fetching a warmup per attempt',async()=>{
 const old=plan();old.preEntryThreeStage!.required=[condition('必要条件',1000)];const next={...old,preEntryThreeStage:retryPreEntryThreeStage(old.preEntryThreeStage!)},oldLoad=vi.fn(loader()),newLoad=vi.fn(loader());
 await run(old,{hours:5,end:T+300*M,load:oldLoad});const result=await run(next,{hours:5,end:T+300*M,load:newLoad});expect(result.retry!.attempt).toBe(300);expect(newLoad.mock.calls.length).toBeLessThanOrEqual(oldLoad.mock.calls.length+1);
});
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

it('records exclusion, rejection, recovery and final admission without duplicating observations on resume',async()=>{
 let clock=0;vi.spyOn(performance,'now').mockImplementation(()=>clock+=200);
 const p=plan();p.preEntryThreeStage!.required=[condition('price',105)];
 const load=loader([100,100,100,100,100,110,110,110,110,110]);
 const aborter=new AbortController(),paused=await run(p,{load,aborter,hours:1,onRecord:r=>{if(r.status==='scanning'&&r.cursor===T+6*M)aborter.abort();}}),before=structuredClone(paused);
 const resumed=await run(p,{load,old:paused,hours:1}),whole=await run(p,{load,hours:1});
 expect(resumed.matchedAt).toBe(T+10*M);expect(paused).toEqual(before);
 expect(resumed.exclusionProcess!.entries.filter(e=>e.kind==='observation')).toEqual(whole.exclusionProcess!.entries.filter(e=>e.kind==='observation'));
 expect(resumed.exclusionProcess!.entries.find(e=>e.kind==='guard-rejected')).toMatchObject({from:T+5*M,reason:expect.stringContaining('price')});
 expect(resumed.exclusionProcess!.entries.find(e=>e.stage==='necessary')).toMatchObject({from:T+M,through:T+5*M,count:5,endedAt:T+6*M,nextStatus:'pass'});
 expect(resumed.exclusionProcess!.entries.at(-1)).toMatchObject({kind:'matched',from:T+10*M});
});

it('retains the first admitted node if pause arrives just after publishing the match',async()=>{
 const aborter=new AbortController(),r=await run(plan(),{aborter,onRecord:r=>{if(r.status==='matched')aborter.abort();}});
 expect(r).toMatchObject({status:'matched',cursor:T+5*M,matchedAt:T+5*M});
 expect(r.exclusionProcess!.entries.at(-1)?.kind).toBe('matched');
});

it('yields during already-saved resume history so a queued pause can interrupt before the next chunk',async()=>{
 const p=retryPlan();p.preEntryThreeStage!.required=[condition('始终等待',200)];
 const old:PreEntryRecord={id:'r',roundId:'round',planId:p.id,sample,status:'paused',startTime:T,cursor:T+450*M,readings:[],updatedAt:T};
 const aborter=new AbortController();let clock=0;
 const timing=vi.spyOn(performance,'now').mockImplementation(()=>clock+=20);
 const abort=setTimeout(()=>aborter.abort(),0);
 try{const result=await run(p,{old,aborter,end:T+500*M,hours:10});expect(aborter.signal.aborted).toBe(true);expect(result.status).toBe('paused');expect(result.cursor).toBe(old.cursor);}
 finally{clearTimeout(abort);timing.mockRestore();}
});

it('defaults to a one-time signal gate and fingerprints the tracking path separately', async () => {
  const p = stateOnlyPlan();
  p.preEntryThreeStage = trackedGatePreEntryThreeStage(p.preEntryThreeStage!);
  p.preEntryThreeStage.required = [condition('门槛',105)];
  expect(p.preEntryThreeStage.requiredPaths).toEqual({static:true,tracking:false});
  const saved = freezeQualityPlan(p);
  const tracked = {...p,preEntryThreeStage:{...p.preEntryThreeStage,requiredPaths:{static:true,tracking:true}}};
  expect(planVersionChanges({...saved,preEntryThreeStage:tracked.preEntryThreeStage}).length).toBeGreaterThan(0);
  expect(await run(saved,{load:loader([110,120])})).toMatchObject({status:'unmatched',signalGate:{status:'blocked'}});
  expect((await run(tracked,{load:loader([70,110,120])})).trackedGate?.at).toBe(T+2*M);
  const staticPass = {...tracked,preEntryThreeStage:{...tracked.preEntryThreeStage,required:[condition('门槛',95)]}};
  const result = await run(staticPass,{load:loader([75,110])});
  expect(result).toMatchObject({status:'matched',matchedAt:T+2*M,signalGate:{status:'pass',at:T}});
  expect(result.trackedGate).toBeUndefined();
});

it.each([true,false])('tracks until the first simultaneous gate pass and ignores a stale event (static selected=%s)', async (staticPath) => {
  const p = stateOnlyPlan();
  p.preEntryThreeStage = trackedGatePreEntryThreeStage(p.preEntryThreeStage!);
  p.preEntryThreeStage.requiredPaths={static:staticPath,tracking:true};
  p.preEntryThreeStage.required = [condition('先达到120',115),condition('保持在130以内',130,'<')];
  p.preEntryThreeStage.admission!.algorithms = [condition('新事件',105)];
  const data=loader([110,120,119,99,110]);
  const result=await run(p,{load:data});
  expect(result).toMatchObject({status:'matched',matchedAt:T+5*M,signalGate:{status:'blocked'},trackedGate:{at:T+2*M,status:'pass',readings:[{value:120,met:true},{value:120,met:true}]}});
});

it('retains the first passing minute on resume and respects the original cutoff', async () => {
  const p=stateOnlyPlan();
  p.preEntryThreeStage=trackedGatePreEntryThreeStage(p.preEntryThreeStage!);
  p.preEntryThreeStage.requiredPaths={static:true,tracking:true};
  p.preEntryThreeStage.required=[condition('门槛',115)];
  p.preEntryThreeStage.admission!.algorithms=[condition('新事件',125)];
  const load=loader([100,120,121,126]);
  const first=await run(p,{load,automatic:true,end:T+3*M,hours:5/60});
  expect(first).toMatchObject({status:'queued',trackedGate:{at:T+2*M,status:'pass'}});
  expect(await run(p,{load,automatic:true,end:T+5*M,hours:5/60,old:first})).toMatchObject({status:'matched',matchedAt:T+4*M,trackedGate:first.trackedGate});
  expect(await run(p,{load,automatic:true,end:T+5*M,hours:1/60})).toMatchObject({status:'unmatched',cursor:T+M,detail:'截止前必要条件未全部满足'});
});

it.each([
  [true, true, true, 2], [true, true, false, 2],
  [true, false, true, 2], [true, false, false, 2],
  [false, true, true, 4], [false, true, false, 1],
  [false, false, true, 2], [false, false, false, 1],
] as const)('executes only enabled stages (necessary=%s admission=%s exclusion=%s)', async (required,admission,exclusion,minute) => {
  const p=stateOnlyPlan();
  p.preEntryThreeStage=optionalStagesPreEntryThreeStage(p.preEntryThreeStage!);
  p.preEntryThreeStage.steps={required,admission,exclusion};
  p.preEntryThreeStage.requiredPaths={static:true,tracking:true};
  p.preEntryThreeStage.required=[condition('必要资格',103)];
  p.preEntryThreeStage.longDrawdown={enabled:true,mode:'current',hours:1/60,pct:6};
  const load=vi.fn(loader([85,105,75,110]));
  const result=await run(p,{load,end:T+4*M});
  expect(result).toMatchObject({status:'matched',matchedAt:T+minute*M});
  if(required)expect(result.trackedGate?.at).toBe(T+2*M);
  else expect(result.signalGate).toBeUndefined();
  if(admission)expect(result.threeStage?.admission?.met).toEqual(['状态 S']);
  else expect(result.threeStage?.admission).toMatchObject({skipped:true,met:[]});
  expect(result.threeStage?.readings.some(reading=>reading.id==='long-drawdown-v1')).toBe(exclusion);
  if(!required&&exclusion) {
    expect(result.lastVeto?.at).toBe(T+M);
    if(!admission)expect(result.exclusionProcess?.entries.find(e=>e.stage==='exclusion')?.admission)
      .toMatchObject({at:T+M,labels:['已跳过事件准入']});
  }
});

it('admits a previously qualifying indicator at the tracked gate, including after an automatic resume',async()=>{
  const p=stateOnlyPlan();
  p.preEntryThreeStage=optionalStagesPreEntryThreeStage(p.preEntryThreeStage!);
  p.preEntryThreeStage.requiredPaths={static:true,tracking:true};
  p.preEntryThreeStage.required=[condition('门槛',115)];
  const load=loader([110,120,121]);
  const first=await run(p,{load,automatic:true,end:T+M});
  expect(first).toMatchObject({status:'queued',cursor:T+M});
  const resumed=await run(p,{load,automatic:true,end:T+3*M,old:first});
  const fresh=await run(p,{load,automatic:true,end:T+3*M});
  expect(resumed).toMatchObject({status:'matched',matchedAt:T+2*M,trackedGate:{at:T+2*M}});
  expect(resumed.threeStage).toEqual(fresh.threeStage);
});

it('does not admit through an enabled exclusion at the original deadline',async()=>{
  const p=stateOnlyPlan();
  p.preEntryThreeStage=optionalStagesPreEntryThreeStage(p.preEntryThreeStage!);
  p.preEntryThreeStage.steps={required:false,admission:false,exclusion:true};
  p.preEntryThreeStage.hardVetoes=[{id:'never',label:'全程排除',enabled:true,kind:'indicator',metric:'raw',snapshot:snapshot(),direction:'>',threshold:0}];
  expect(await run(p,{load:loader([110,115,120]),hours:2/60,end:T+4*M}))
    .toMatchObject({status:'unmatched',cursor:T+2*M,endTime:T+2*M,lastVeto:{at:T+2*M,count:2}});
});

function gateTimePlan() {
  const p = stateOnlyPlan();
  p.preEntryThreeStage = signalAnchoredPreEntryThreeStage(p.preEntryThreeStage!);
  p.preEntryThreeStage.steps!.admission = false;
  return p;
}

it('anchors a passing static gate to the exact original signal time and reads no later candle', async () => {
  const p = gateTimePlan(), config = p.preEntryThreeStage!;
  config.required = [condition('静态门槛', 90)];
  config.hardVetoes = [{id:'five',label:'五分钟否决',enabled:true,kind:'indicator',metric:'raw',snapshot:snapshot('raw=C','5m'),direction:'>',threshold:150}];
  const at = T + 27_000;
  const old: PreEntryRecord = {id:'r',roundId:'round',planId:p.id,sample:{...sample,enteredAt:at,source:{...sample.source,timeMs:at}},
    status:'queued',startTime:at,cursor:at,readings:[],updatedAt:T};
  const read = loader([170,180,190]);
  const load: FishReconstructionLoader = async (row,from,to,plan,signal) => {
    expect(to).toBeLessThanOrEqual(T);
    return read(row,from,to,plan,signal);
  };
  const result = await run(p,{old,load});
  expect(result).toMatchObject({status:'matched',matchedAt:at,cursor:at,entryTimeBasis:'signal',signalGate:{signalAt:at,at:T,status:'pass'},
    threeStage:{at,admission:{skipped:true},readings:[{at:T,value:100,met:false}]}});
  expect(preEntrySignal(result)).toMatchObject({timeMs:at,preEntryMonitor:{sourceTime:at,matchedAt:at}});
});

it('uses the static signal time when all steps are skipped, without requesting a later minute', async () => {
  const p=gateTimePlan();
  p.preEntryThreeStage!.steps={required:false,admission:false,exclusion:false};
  const load=vi.fn(loader());
  expect(await run(p,{load,end:T})).toMatchObject({status:'matched',matchedAt:T,cursor:T,entryTimeBasis:'signal'});
  expect(load).not.toHaveBeenCalled();
});

it('uses the first tracked pass when the static gate fails or only tracking is selected', async () => {
  const p=gateTimePlan(), config=p.preEntryThreeStage!;
  config.requiredPaths={static:true,tracking:true};
  config.required=[condition('动态门槛',115)];
  expect(await run(p,{load:loader([110,120,125])})).toMatchObject({status:'matched',matchedAt:T+2*M,entryTimeBasis:'tracked',trackedGate:{at:T+2*M}});
  config.requiredPaths={static:false,tracking:true};
  config.required=[condition('动态门槛',95)];
  expect(await run(p,{load:loader([110,120])})).toMatchObject({status:'matched',matchedAt:T+M,entryTimeBasis:'tracked',trackedGate:{at:T+M}});
});

it('checks the configured closed history and stops at the only candidate when it is excluded', async () => {
  const p=gateTimePlan(), config=p.preEntryThreeStage!;
  const sell={...condition('历史卖出',99),snapshot:snapshot('raw=C','5m'),timing:'closed' as const};
  config.sellRules=[{id:'history',label:'两根确认',enabled:true,expression:{condition:sell},confirmation:{samples:2,minutes:5}}];
  expect(await run(p)).toMatchObject({status:'unmatched',cursor:T,lastVeto:{at:T,reason:expect.stringContaining('两根确认')}});
  config.sellRules=[];
  config.requiredPaths={static:true,tracking:true};
  config.required=[condition('门槛',115)];
  config.hardVetoes=[{id:'hard',label:'首次通过时排除',enabled:true,kind:'indicator',metric:'raw',snapshot:snapshot(),direction:'>',threshold:110}];
  expect(await run(p,{load:loader([100,120,85,120])})).toMatchObject({status:'unmatched',cursor:T+2*M,trackedGate:{at:T+2*M},lastVeto:{at:T+2*M}});
});

it('records the admitted event time when events are enabled in the new engine', async () => {
  const p=gateTimePlan(), config=p.preEntryThreeStage!;
  config.steps!.admission=true;
  config.requiredPaths={static:true,tracking:true};
  config.required=[condition('动态门槛',115)];
  config.admission!.algorithms=[condition('事件',125)];
  expect(await run(p,{load:loader([100,120,121,126])})).toMatchObject({
    status:'matched',matchedAt:T+4*M,trackedGate:{at:T+2*M},threeStage:{admission:{met:['事件']}},
  });
});

it('vetoes a distant candidate and admits a later event with a valid nearby close',async()=>{
 const p=retryPlan();
 p.preEntryThreeStage=signalAnchoredPreEntryThreeStage(p.preEntryThreeStage!);
 p.preEntryThreeStage.additionVetoes=[{...ADDITION_VETO_DEFAULTS['guard-distance'],enabled:true,guardDistance:guardDistanceConfig()}];
 const five=5*M,structure=new Map(dblBars().map((bar,i)=>[T+(i-14)*five,{...bar,openTime:T+(i-14)*five,volume:1}]));
 const other=loader([100,100,100,100,125,100,100,100,100,100]);
 const load:FishReconstructionLoader=async(row,from,to,program,signal)=>{
  if(!program.compiled.usesDbl5)return other(row,from,to,program,signal);
  return Array.from({length:(to-from)/five},(_,i)=>{
   const openTime=from+i*five;
   return structure.get(openTime)??{openTime,open:103,high:104,low:102,close:103,volume:1,takerBuyVolume:.5,DBL5_tick_size:1};
  });
 };
 const result=await run(p,{load});
 expect(result).toMatchObject({status:'matched',matchedAt:T+10*M});
 expect(result.exclusionProcess?.entries.some(e=>e.status==='blocked'&&e.reason.includes('距 DBL-5 防守线过远')&&e.reason.includes('超过阈值 3 ATR'))).toBe(true);
 const old=structuredClone(p);
 old.preEntryThreeStage!.additionVetoes=[];
 expect(await run(old,{load})).toMatchObject({status:'matched',matchedAt:T+5*M});
});
