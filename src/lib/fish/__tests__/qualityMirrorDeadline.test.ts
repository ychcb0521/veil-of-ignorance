import {expect,it} from 'vitest';
import {evaluateQualitySample,qualityResultKey,type QualityGroup,type QualitySample,type QualityResult} from '../quality';
import {makeQualityBuyFilter,makeQualityHoldingVeto,holdingVetoDraft,parseHoldingVetoDraft} from '../qualityFilters';
import {holdingVetoIdentity,validateHoldingVeto} from '../qualityVeto';
import {mirrorHardStopStage} from '../qualityMirrorHardStopStages';
import {MIRROR_DEADLINE_KIND as KIND,MIRROR_DEADLINE_VERSION as VERSION,mirrorCompletedBy,mirrorDeadlineAt} from '../qualityMirrorDeadline';
import {freezeQualityPlan,qualityPlanVersions,planVersionChanges} from '../qualityPlanVersions';
import {emptyPreEntryConditions,validatePreEntryConditions} from '../preEntryConditions';
import {instantMonitorExitDue,instantMonitorSale,evaluateInstantMonitor} from '../instantMonitorExecution';
import {INSTANT_TEMPLATE_MONITOR} from '../instantMonitorSettings';
import {binanceManualAdvance} from '../binanceManualStrategy';
import {BINANCE_MANUAL_MONITOR_VERSION,type BinanceManualPosition} from '../binanceManualMonitor';
import type {FishReconstructionLoader} from '../reconstruction';
import type {ResearchBar} from '@/lib/deepRsa/window';

const M=60_000,T=Date.UTC(2026,10,22),signal=new AbortController().signal;
const definition={id:'price',name:'价格',short:'价格',definition:'',formula:'raw = C',interval:'1m' as const,scale:1,unit:'',positive:'1',control:'0'};
const snapshot=makeQualityBuyFilter('price:raw','<',0,true,[definition]).snapshot;
const sample:QualitySample={id:'s',enteredAt:T,basis:'signal',groups:[],importedAt:T,source:{id:'s',symbol:'TESTUSDT',timeMs:T,timeLabel:'',fallbackZone:''}};
const rule=(hours=1,enabled=true)=>parseHoldingVetoDraft([{choice:KIND,direction:'>=',threshold:String(hours),enabled,mirrorStage:mirrorHardStopStage('before')}],[])[0];
const plan=(hours=1):QualityGroup=>({id:'p',label:'限时终止',metric:'raw',snapshot,vetoFill:'stop',holdingVetoes:[rule(hours)],mirrorTakeProfit:{enabled:true,gainPct:2.5,sellPct:50}});
const positionFixture=():BinanceManualPosition=>({version:BINANCE_MANUAL_MONITOR_VERSION,revision:1,armedAt:T,entryPrice:100,entryQuantity:1,
 anchor:{symbol:'TESTUSDT',positionSide:'LONG',openedAt:T,openingTradeId:'1',openingOrderId:'2'},
 monitor:{version:INSTANT_TEMPLATE_MONITOR,templateId:'tpl',name:'新副本',plan:freezeQualityPlan(plan())}});
const bar=(at:number,open=100,high=open,low=open,close=open):ResearchBar=>({openTime:at,open,high,low,close,volume:1,takerBuyVolume:.5});
const loader=(path:(at:number)=>ResearchBar=bar):FishReconstructionLoader=>async(_row,from,to,p)=>Array.from({length:(to-from)/p.step},(_,i)=>path(from+i*p.step));
const run=(g=plan(),minutes=61,load=loader(),prior?:QualityResult)=>evaluateQualitySample(sample,g,0,T+minutes*M,load,signal,prior);

it('does not exit early; issues the deadline at exactly one hour without waiting for a future candle price',async()=>{
 const before=await run(plan(),59);expect(before.status).toBe('open');expect(before.pendingExit).toBeUndefined();
 const due=await run(plan(),60,loader(),before);
 expect(due).toMatchObject({status:'open',pendingExit:{at:T+60*M,atOpen:true,cause:{kind:KIND,mirrorDeadlineVersion:VERSION,threshold:1}}});
 expect(instantMonitorExitDue(due)).toBe(true);expect(instantMonitorSale(due).at).toBe(T+60*M);
 const closed=await run(plan(),61,loader(t=>bar(t,t===T+60*M?90:100)),due);
 expect(closed).toMatchObject({status:'closed',endTime:T+60*M,endPrice:90,exitSnapshot:{cause:{kind:KIND}}});
});
it.each([0,30,59])('keeps holding when mirror execution was already completed in minute %s',async minute=>{
 const r=await run(plan(),90,loader(t=>t===T+minute*M?bar(t,100,103,100,100):bar(t)));
 expect(r.status,r.reason).toBe('open');expect(r.mirrorFill?.at).toBe(T+minute*M);expect(r.pendingExit).toBeUndefined();
});
it('does not use a later high or a planned target as proof of a mirror fill',async()=>{
 const r=await run(plan(),61,loader(t=>t===T+60*M?bar(t,100,200,99,150):bar(t)));
 expect(r).toMatchObject({status:'closed',endTime:T+60*M,endPrice:100});expect(r.mirrorFill).toBeUndefined();
});
it('supports custom hours, disabled conditions and a disabled mirror strategy',async()=>{
 expect(await run(plan(.5),31)).toMatchObject({status:'closed',endTime:T+30*M});
 const disabled={...plan(),holdingVetoes:[rule(1,false)]};expect((await run(disabled,90)).status).toBe('open');
 expect(await run({...plan(),mirrorTakeProfit:undefined},61)).toMatchObject({status:'closed',endTime:T+60*M});
});
it('checks the 0.5-hour setting at 30 minutes, without waiting for the next candle price',async()=>{
 const g=plan(.5),before=await run(g,29);
 expect(before.status).toBe('open');expect(before.pendingExit).toBeUndefined();
 const due=await run(g,30,loader(),before);
 expect(due.pendingExit).toMatchObject({at:T+30*M,cause:{kind:KIND,threshold:.5}});
 expect(instantMonitorExitDue(due)).toBe(true);
 const completed=await run(g,60,loader(t=>t===T+29*M?bar(t,100,103,100):bar(t)));
 expect(completed.status).toBe('open');expect(completed.pendingExit).toBeUndefined();
});
it('resumes using original entry time despite a later actual addition and preserves the checkpoint',async()=>{
 const g=plan(),prior=await run(g,45);
 prior.additionFill={at:T+40*M,price:100,notional:100,quantity:1,scanFrom:T,reading:1,threshold:0,direction:'>',metric:'raw',label:'已成交加仓',barOpenTime:T+40*M};
 const frozen=structuredClone(prior),r=await run(g,61,loader(),prior);
 expect(r).toMatchObject({status:'closed',endTime:T+60*M});expect(prior).toEqual(frozen);
});
it('other hard stops remain independent and can close before the deadline',async()=>{
 const g={...plan(),holdingVetoes:[rule(),makeQualityHoldingVeto('static-drawdown','>=',5)]};
 expect(await run(g,61,loader(t=>t===T+10*M?bar(t,100,100,94):bar(t)))).toMatchObject({status:'closed',endTime:T+10*M,exitSnapshot:{cause:{kind:'static-drawdown'}}});
});
it('uses the first minute at or after the original deadline and validates actual saved executions',()=>{
 expect(mirrorDeadlineAt(T+30_000,1)).toBe(T+61*M);
 const fill={at:T+59*M,price:103,fraction:.5,gainPct:3,atOpen:false};
 expect(mirrorCompletedBy(fill,T,T+60*M)).toBe(true);
 expect(mirrorCompletedBy({...fill,at:T+60*M},T,T+60*M)).toBe(false);
 expect(mirrorCompletedBy({...fill,at:T+60*M,atOpen:true},T,T+60*M)).toBe(true);
 expect(mirrorCompletedBy({...fill,fraction:0},T,T+60*M)).toBe(false);
 expect(mirrorCompletedBy({...fill,executedAt:T+59*M+30_000},T,T+60*M)).toBe(true);
 expect(mirrorCompletedBy({...fill,executedAt:T+60*M+1},T,T+60*M)).toBe(false);
});
it.each([0,-1,NaN,Infinity,1/120,8785])('rejects invalid duration %s',hours=>{
 expect(()=>makeQualityHoldingVeto(KIND,'>=',hours)).toThrow(/时长/);
});
it('round-trips durations and versions, rejects silent upgrades and inapplicable after-mirror/entry scopes',()=>{
 const saved=[rule(1.23456789)],before=structuredClone(saved);
 expect(parseHoldingVetoDraft(holdingVetoDraft(saved),[])).toEqual(saved);
 expect(()=>validateHoldingVeto({...saved[0],mirrorStage:mirrorHardStopStage('after')})).toThrow(/镜像前/);
 expect(()=>validatePreEntryConditions({...emptyPreEntryConditions(),hardVetoes:[{...saved[0],mirrorStage:undefined}]})).toThrow(/实际持仓/);
 const invalid=holdingVetoDraft(saved);invalid[0].saved!.mirrorDeadlineVersion='future-v2' as typeof VERSION;
 expect(()=>parseHoldingVetoDraft(invalid,[])).toThrow(/版本/);expect(saved).toEqual(before);
});
it('freezes new execution and duration independently while old plan keys and template manifests stay unchanged',()=>{
 const old=freezeQualityPlan({...plan(),holdingVetoes:[makeQualityHoldingVeto('static-drawdown','>=',5)]}),before=structuredClone(old);
 const key=qualityResultKey(sample,old,0),identity=holdingVetoIdentity(old.holdingVetoes),manifest=qualityPlanVersions(old);
 const saved=freezeQualityPlan(plan()),changed=structuredClone(saved);changed.holdingVetoes![0].threshold=2;
 expect(saved.frozenVersions?.find(v=>v.key==='hard-stop-mirror-deadline')?.version).toContain(VERSION);
 expect(planVersionChanges(saved)).toEqual([]);expect(planVersionChanges(changed).some(v=>v.key==='hard-stop-mirror-deadline')).toBe(true);
 expect(qualityResultKey(sample,old,0)).toBe(key);expect(holdingVetoIdentity(old.holdingVetoes)).toEqual(identity);
 expect(qualityPlanVersions(old)).toEqual(manifest);expect(old).toEqual(before);
});
it('instant templates and managed Binance positions produce a close decision at the pending deadline without fabricating a fill',async()=>{
 const g=freezeQualityPlan(plan()),monitor={version:INSTANT_TEMPLATE_MONITOR,templateId:'tpl',name:'新副本',plan:g};
 const observed=await evaluateInstantMonitor(sample,monitor,T+60*M,loader(),signal);
 const prior=await run(g,59),before=structuredClone(observed);
 const position=positionFixture();
 const advanced=binanceManualAdvance(position,prior,observed);
 expect(advanced?.decision).toMatchObject({kind:'close',action:{action:'close',at:T+60*M}});
 expect(advanced?.checkpoint).toEqual(prior);expect(observed.status).toBe('open');expect(observed).toEqual(before);
 expect(instantMonitorExitDue({...observed,pendingExit:{...observed.pendingExit!,cause:{...observed.pendingExit!.cause!,mirrorDeadlineVersion:'future-v2' as typeof VERSION}}})).toBe(false);
});
it('real positions count reconciled mirror fills only, never a price touch or an unexecuted replay proposal',async()=>{
 const actual={...sample,binanceEntry:{version:BINANCE_MANUAL_MONITOR_VERSION,orderId:'opening',price:100,quantity:1}};
 const path=loader(t=>t===T+59*M?bar(t,100,103,100):bar(t));
 const r=await evaluateQualitySample(actual,plan(),0,T+60*M,path,signal,undefined,100,T+60*M);
 expect(r).toMatchObject({status:'open',pendingExit:{cause:{kind:KIND}}});expect(r.mirrorFill).toBeUndefined();
 const prior=await evaluateQualitySample(actual,plan(),0,T+59*M,loader(),signal,undefined,100,T+59*M);
 const settled={...prior,mirrorFill:{at:T+58*M,price:103,fraction:.5,gainPct:3,atOpen:false}};
 const holding=await evaluateQualitySample(actual,plan(),0,T+61*M,loader(),signal,settled,100,T+61*M);
 expect(holding.status,holding.reason).toBe('open');expect(holding.pendingExit).toBeUndefined();
 const late={...settled,mirrorFill:{...settled.mirrorFill,executedAt:T+60*M+1}};
 expect((await evaluateQualitySample(actual,plan(),0,T+61*M,loader(),signal,late,100,T+61*M)).exitSnapshot?.cause?.kind).toBe(KIND);
 const reconciled={...late,endTime:T+61*M};
 const immediate=await evaluateQualitySample(actual,plan(),0,T+61*M,loader(),signal,reconciled,100,T+61*M);
 expect(immediate.pendingExit?.cause?.kind).toBe(KIND);expect(instantMonitorExitDue(immediate)).toBe(true);
 const proposal={at:T+50*M,price:100,notional:100,quantity:1,scanFrom:T,reading:1,threshold:0,direction:'>' as const,metric:'raw',label:'尚未成交加仓',barOpenTime:T+50*M};
 expect(binanceManualAdvance(positionFixture(),prior,{...r,additionFills:[proposal]})?.decision?.kind).toBe('close');
});
