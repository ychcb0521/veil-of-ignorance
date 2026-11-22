import {expect,it} from 'vitest';
import {makeQualityHoldingVeto,makeQualityBuyFilter,holdingVetoDraft,parseHoldingVetoDraft} from '../qualityFilters';
import {MIRROR_LOSS_REVIEW_KIND as KIND,MIRROR_LOSS_REVIEW_VERSION as V2,MIRROR_LOSS_THRESHOLD_VERSION as V3,reviewMirrorLoss,type MirrorLossThreshold} from '../qualityMirrorLossReview';
import {holdingVetoIdentity,validateHoldingVeto} from '../qualityVeto';
import {freezeQualityPlan,planVersionChanges,qualityPlanVersions} from '../qualityPlanVersions';
import {evaluateQualitySample,qualityResultKey,type QualityGroup,type QualitySample} from '../quality';
import {instantMonitorExitDue} from '../instantMonitorExecution';
import type {QualityAdditionFill} from '../qualityAddition';
import type {FishReconstructionLoader} from '../reconstruction';
const M=60000,T=Date.UTC(2026,10,23),signal=new AbortController().signal;
const rule=(unit:MirrorLossThreshold['unit']='percent',value=2)=>makeQualityHoldingVeto(KIND,'>=',1,true,[],100,{version:V3,unit,value});
const review=(unit:MirrorLossThreshold['unit'],value:number,price:number,notional=100,additions:QualityAdditionFill[]=[])=>reviewMirrorLoss({rules:[rule(unit,value)],entry:T,end:T+60*M,entryPrice:100,notional,additions,readPrice:async()=>price});
const def={id:'p',name:'价格',short:'价格',definition:'',formula:'raw=C',interval:'1m' as const,scale:1,unit:'',positive:'1',control:'0'};
const snapshot=makeQualityBuyFilter('p:raw','<',0,true,[def]).snapshot;
const plan=(unit:MirrorLossThreshold['unit']='percent',value=2):QualityGroup=>({id:'p',label:'亏损门槛',metric:'raw',snapshot,vetoFill:'stop',holdingVetoes:[rule(unit,value)],mirrorTakeProfit:{enabled:true,gainPct:50,sellPct:50}});
const sample:QualitySample={id:'s',enteredAt:T,groups:[],basis:'signal',importedAt:T,source:{id:'s',symbol:'TESTUSDT',timeMs:T,timeLabel:'',fallbackZone:''}};
it.each(['percent','usdt'] as const)('zero threshold retains actual-loss-only behavior and never closes flat or profitable holdings (%s)',async unit=>{
 expect((await review(unit,0,99)).stop).toBeDefined();
 expect((await review(unit,0,100)).stop).toBeUndefined();expect((await review(unit,0,101)).stop).toBeUndefined();
});
it.each([
 ['percent',2,98,true],['percent',2,98.0001,false],['percent',2,97.9,true],
 ['usdt',2,98,true],['usdt',2,98.0001,false],['usdt',2,97.9,true],
] as const)('uses inclusive thresholds with no display rounding: %s %s at price %s',async(unit,value,price,closed)=>{
 const r=await review(unit,value,price);expect(!!r.stop).toBe(closed);
 expect(r.states[rule(unit,value).id].version).toBe(V3);
});
it('percentage uses total invested notional including additions, while USDT compares the actual whole-campaign loss',async()=>{
 const add:QualityAdditionFill={at:T+40*M,price:100,notional:100,quantity:1,scanFrom:T,reading:1,threshold:0,direction:'>',metric:'raw',label:'加仓',barOpenTime:T+40*M};
 const below=await review('percent',4,97,100,[add]);expect(below.stop).toBeUndefined();
 expect(below.states[rule('percent',4).id].checks[0]).toMatchObject({pnl:-6,pnlPct:-3,totalInvested:200});
 expect((await review('percent',3,97,100,[add])).stop).toBeDefined();
 expect((await review('usdt',6,97,100,[add])).stop).toBeDefined();
 expect((await review('usdt',7,97,100,[add])).stop).toBeUndefined();
});
it('keeps observing a loss below the threshold and issues a market exit only when a later scheduled check reaches it',async()=>{
 const load:FishReconstructionLoader=async(_r,a,b,p)=>Array.from({length:(b-a)/p.step},(_,i)=>{
  const at=a+i*p.step,price=at>=T+70*M?97.5:98.5;
  return {openTime:at,open:at===T?100:price,high:at===T?100:price,low:price,close:price,volume:1,takerBuyVolume:.5};
 });
 const g=plan(),first=await evaluateQualitySample(sample,g,0,T+60*M,load,signal,undefined,100);
 expect(first.pendingExit).toBeUndefined();expect(first.mirrorLossReviews?.[g.holdingVetoes![0].id].checks[0]).toMatchObject({pnlPct:-1.5,decision:'continue'});
 const due=await evaluateQualitySample(sample,g,0,T+90*M,load,signal,first,100);
 expect(due.pendingExit?.cause).toMatchObject({mirrorDeadlineVersion:V3,mirrorLossReview:{pnlPct:-2.5,lossThreshold:{version:V3,unit:'percent',value:2}}});
 expect(instantMonitorExitDue(due)).toBe(true);
});
it.each([-1,NaN,Infinity])('rejects invalid editable loss values %s',value=>{
 expect(()=>rule('percent',value)).toThrow(/亏损门槛/);
});
it('does not silently accept unknown units, versions, missing metadata or mixed legacy assets',()=>{
 expect(()=>rule('btc' as 'percent',2)).toThrow(/有效单位/);
 const v=rule();expect(()=>validateHoldingVeto({...v,mirrorLossThreshold:undefined})).toThrow(/亏损门槛/);
 expect(()=>validateHoldingVeto({...v,mirrorLossThreshold:{...v.mirrorLossThreshold!,version:'future-v4' as typeof V3}})).toThrow(/亏损门槛/);
 expect(()=>validateHoldingVeto({...v,mirrorDeadlineVersion:V2})).toThrow(/不能自动/);
 const draft=holdingVetoDraft([v]);draft[0].lossThreshold!.value='';expect(()=>parseHoldingVetoDraft(draft,[])).toThrow(/亏损门槛/);
});
it('freezes units and full-precision values in identities, result keys and manifests while preserving original v2 assets',()=>{
 const old=freezeQualityPlan({...plan(),holdingVetoes:[makeQualityHoldingVeto(KIND,'>=',1)]}),before=structuredClone(old);
 const current=freezeQualityPlan(plan('percent',2.123456789)),cash=freezeQualityPlan(plan('usdt',2.123456789)),changed=structuredClone(current);
 changed.holdingVetoes![0].mirrorLossThreshold!.value=3;
 expect(parseHoldingVetoDraft(holdingVetoDraft(current.holdingVetoes),[])).toEqual(current.holdingVetoes);
 expect(holdingVetoIdentity(current.holdingVetoes)).not.toEqual(holdingVetoIdentity(cash.holdingVetoes));
 expect(qualityResultKey(sample,current,0)).not.toBe(qualityResultKey(sample,cash,0));
 expect(current.frozenVersions?.find(v=>v.key==='hard-stop-mirror-loss-review')?.version).toContain(V3);
 expect(planVersionChanges(changed).some(v=>v.key==='hard-stop-mirror-loss-review')).toBe(true);
 expect(planVersionChanges(current)).toEqual([]);expect(qualityPlanVersions(old)).toEqual(before.frozenVersions);expect(old).toEqual(before);
});
