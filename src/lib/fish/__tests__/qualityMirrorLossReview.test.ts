import {expect,it,vi} from 'vitest';
import {evaluateQualitySample,type QualityGroup,type QualitySample,type QualityResult} from '../quality';
import {makeQualityBuyFilter,makeQualityHoldingVeto,holdingVetoDraft,parseHoldingVetoDraft} from '../qualityFilters';
import {freezeQualityPlan,planVersionChanges,qualityPlanVersions} from '../qualityPlanVersions';
import {MIRROR_DEADLINE_KIND,MIRROR_DEADLINE_VERSION} from '../qualityMirrorDeadline';
import {MIRROR_LOSS_REVIEW_KIND as KIND,MIRROR_LOSS_REVIEW_VERSION as VERSION,mirrorLossReviewPoints,reviewMirrorLoss} from '../qualityMirrorLossReview';
import {mirrorHardStopStage} from '../qualityMirrorHardStopStages';
import {instantMonitorExitDue,instantMonitorSale} from '../instantMonitorExecution';
import {BINANCE_MANUAL_MONITOR_VERSION} from '../binanceManualMonitor';
import type {QualityAdditionFill,QualityReductionFill} from '../qualityAddition';
import type {FishReconstructionLoader} from '../reconstruction';
import type {ResearchBar} from '@/lib/deepRsa/window';
const M=60_000,T=Date.UTC(2026,10,23),signal=new AbortController().signal;
const def={id:'price',name:'价格',short:'价格',definition:'',formula:'raw=C',interval:'1m' as const,scale:1,unit:'',positive:'1',control:'0'};
const snapshot=makeQualityBuyFilter('price:raw','<',0,true,[def]).snapshot;
const sample:QualitySample={id:'s',enteredAt:T,groups:[],basis:'signal',importedAt:T,source:{id:'s',symbol:'TESTUSDT',timeMs:T,timeLabel:'',fallbackZone:''}};
const rule=(hours=1)=>parseHoldingVetoDraft([{choice:KIND,direction:'>=',threshold:String(hours),enabled:true,mirrorStage:mirrorHardStopStage('before')}],[])[0];
const plan=(hours=1):QualityGroup=>({id:'p',label:'定时亏损终止',metric:'raw',snapshot,vetoFill:'stop',holdingVetoes:[rule(hours)],mirrorTakeProfit:{enabled:true,gainPct:5,sellPct:50}});
const bar=(t:number,price=100,high=price):ResearchBar=>({openTime:t,open:t===T?100:price,high:Math.max(t===T?100:price,high),low:Math.min(t===T?100:price,price),close:price,volume:1,takerBuyVolume:.5});
const loader=(path:(at:number)=>ResearchBar=(at)=>bar(at)):FishReconstructionLoader=>async(_r,a,b,p)=>Array.from({length:(b-a)/p.step},(_,i)=>path(a+i*p.step));
const run=(minutes:number,load=loader(),prior?:QualityResult,g=plan())=>evaluateQualitySample(sample,g,0,T+minutes*M,load,signal,prior);
const add=(at:number,price=130):QualityAdditionFill=>({at,price,quantity:1,notional:price,scanFrom:T,reading:1,threshold:0,direction:'>',metric:'raw',label:'实际加仓',barOpenTime:at});

it('checks exactly 1, 1.5, 2 ... 12 hours and supports an independently editable first check',()=>{
 expect(mirrorLossReviewPoints(T,1).map(t=>(t-T)/(60*M))).toEqual(Array.from({length:23},(_,i)=>1+i*.5));
 expect(mirrorLossReviewPoints(T,.5)).toHaveLength(24);
 expect(mirrorLossReviewPoints(T,2)[0]).toBe(T+120*M);
});
it.each(Array.from({length:23},(_,i)=>60+i*30))('can first become losing at the %s-minute checkpoint and exits at that point',async minute=>{
 const r=await run(minute+1,loader(t=>bar(t,t>=T+(minute-1)*M?99:101)));
 expect(r.status,r.reason).toBe('closed');expect(r.endTime).toBe(T+minute*M);
 expect(r.exitSnapshot?.cause).toMatchObject({kind:KIND,mirrorDeadlineVersion:VERSION,mirrorLossReview:{at:T+minute*M,decision:'close'}});
 expect(r.mirrorFill).toBeUndefined();
});
it('profits at one hour continue; the later 1.5-hour loss produces an immediate market exit',async()=>{
 const path=loader(t=>bar(t,t>=T+70*M?99:101));
 const first=await run(60,path);expect(first.status).toBe('open');expect(first.pendingExit).toBeUndefined();
 expect(first.mirrorLossReviews?.[rule().id].checks).toMatchObject([{at:T+60*M,decision:'continue'}]);
 const between=await run(80,path,first);expect(between.pendingExit).toBeUndefined();
 const due=await run(90,path,between);expect(due.status).toBe('open');expect(due.pendingExit?.at).toBe(T+90*M);
 expect(instantMonitorExitDue(due)).toBe(true);expect(instantMonitorSale(due).at).toBe(T+90*M);
 const closed=await run(91,path,due);expect(closed).toMatchObject({status:'closed',endTime:T+90*M,endPrice:99});
 const whole=await run(91,path);expect(closed.mirrorLossReviews).toEqual(whole.mirrorLossReviews);
});
it('does not exit between checkpoints, on breakeven, or merely because 12 hours elapsed',async()=>{
 const intermediate=await run(181,loader(t=>bar(t,(t===T+65*M||t===T+80*M)?99:100)));
 expect(intermediate.status,intermediate.reason).toBe('open');expect(intermediate.pendingExit).toBeUndefined();
 const late=await run(781,loader(t=>bar(t,t>=T+749*M?90:100)));
 expect(late.status,late.reason).toBe('open');expect(late.pendingExit).toBeUndefined();
 expect(late.mirrorLossReviews?.[rule().id]).toMatchObject({finished:'window-ended',through:T+720*M});
 expect(late.mirrorLossReviews?.[rule().id].checks).toHaveLength(23);
});
it('an actual earlier mirror permanently removes this rule while earlier losses cannot borrow a future mirror',async()=>{
 const settled=await run(181,loader(t=>t===T+75*M?bar(t,101,106):bar(t,t>=T+80*M?95:101)));
 expect(settled.status,settled.reason).toBe('open');expect(settled.mirrorLossReviews?.[rule().id].finished).toBe('mirror-completed');
 const future=await run(181,loader(t=>t===T+120*M?bar(t,101,106):bar(t,99)));
 expect(future).toMatchObject({status:'closed',endTime:T+60*M});expect(future.mirrorFill).toBeUndefined();
});
it('uses only the known closing price at each checkpoint; future gaps change execution price without changing the decision',async()=>{
 const path=loader(t=>bar(t,t===T+59*M?99:t===T+60*M?120:101));
 const due=await run(60,path);expect(due.pendingExit?.cause?.mirrorLossReview?.price).toBe(99);
 const final=await run(61,path,due);expect(final).toMatchObject({status:'closed',endTime:T+60*M,endPrice:120});
 expect(final.exitSnapshot?.cause?.mirrorLossReview?.pnl).toBeLessThan(0);
});
it('accounts for actual additions rather than comparing only with the original entry price',async()=>{
 const g=plan(),actual={...sample,binanceEntry:{version:BINANCE_MANUAL_MONITOR_VERSION,orderId:'entry',price:100,quantity:1}};
 const prior=await evaluateQualitySample(actual,g,0,T+59*M,loader(),signal,undefined,100);
 prior.additionFill=add(T+40*M);prior.additionFills=[prior.additionFill];prior.remainingQuantity=2;prior.remainingCost=230;
 const original=structuredClone(prior);
 const due=await evaluateQualitySample(actual,g,0,T+60*M,loader(t=>bar(t,110)),signal,prior,100,T+60*M);
 expect(due.pendingExit?.cause?.mirrorLossReview).toMatchObject({pnl:-10,quantity:2,cost:230,price:110});
 expect(instantMonitorExitDue(due)).toBe(true);expect(due.mirrorFill).toBeUndefined();expect(prior).toEqual(original);
});
it('includes realized PnL, ignores later fills, freezes passed checkpoints and preserves saved observations',async()=>{
 const reduction:QualityReductionFill={at:T+40*M,price:120,fraction:.5,quantity:.5,costRemoved:50,realizedPnl:10,breakeven:100,previousK:95,newK:90,previousSupport:98,newSupport:93,atr:1};
 const first=await reviewMirrorLoss({rules:[rule()],entry:T,end:T+60*M,entryPrice:100,notional:100,additions:[add(T+70*M)],reductions:[reduction],readPrice:async()=>90});
 expect(first.stop).toBeUndefined();expect(first.states[rule().id].checks[0]).toMatchObject({pnl:5,quantity:.5,cost:50,realizedPnl:10});
 const frozen=structuredClone(first.states),readPrice=vi.fn(async()=>80);
 const next=await reviewMirrorLoss({rules:[rule()],entry:T,end:T+80*M,entryPrice:100,notional:100,additions:[add(T+70*M)],reductions:[reduction],previous:first.states,readPrice});
 expect(readPrice).not.toHaveBeenCalled();expect(next.states).toEqual(frozen);expect(first.states).toEqual(frozen);
});
it('reconciled mirror completion stops live checks without backfilling a missed historical liquidation',async()=>{
 const readPrice=vi.fn(async()=>90);
 const r=await reviewMirrorLoss({rules:[rule()],entry:T,end:T+90*M,entryPrice:100,notional:100,additions:[],actual:true,
  mirror:{at:T+70*M,executedAt:T+71*M,price:106,fraction:.5,gainPct:6,atOpen:false},readPrice});
 expect(r.stop).toBeUndefined();expect(readPrice).not.toHaveBeenCalled();expect(r.states[rule().id].finished).toBe('mirror-completed');
});
it('missing or invalid checkpoint data never become a profitable pass or an invented sale',async()=>{
 await expect(reviewMirrorLoss({rules:[rule()],entry:T,end:T+60*M,entryPrice:100,notional:100,additions:[],readPrice:async()=>NaN})).rejects.toThrow(/有效行情/);
 expect(()=>makeQualityHoldingVeto(KIND,'>=',13)).toThrow(/首次检查/);
});
it('a newly armed live monitor skips past checkpoints instead of backfilling historical liquidation',async()=>{
 const readPrice=vi.fn(async()=>99);
 const first=await reviewMirrorLoss({rules:[rule()],entry:T,end:T+80*M,entryPrice:100,notional:100,additions:[],actual:true,observeFrom:T+70*M,readPrice});
 expect(first.stop).toBeUndefined();expect(readPrice).not.toHaveBeenCalled();
 const due=await reviewMirrorLoss({rules:[rule()],entry:T,end:T+90*M,entryPrice:100,notional:100,additions:[],actual:true,observeFrom:T+70*M,previous:first.states,readPrice});
 expect(due.stop?.check.at).toBe(T+90*M);
});
it('does not apply a condition retroactively to checkpoints from an inactive seller phase',async()=>{
 const first=await reviewMirrorLoss({rules:[rule()],entry:T,end:T+60*M,entryPrice:100,notional:100,additions:[],readPrice:async()=>101});
 const readPrice=vi.fn(async(at:number)=>at===T+90*M?90:101);
 const resumed=await reviewMirrorLoss({rules:[rule()],entry:T,end:T+130*M,entryPrice:100,notional:100,additions:[],previous:first.states,observeFrom:T+100*M,readPrice});
 expect(resumed.stop).toBeUndefined();expect(readPrice).toHaveBeenCalledExactlyOnceWith(T+120*M);
 expect(resumed.states[rule().id].checks.map(c=>c.at)).toEqual([T+60*M,T+120*M]);
});
it('freezes the new loss schedule independently and keeps the v1 template byte-for-byte unchanged',()=>{
 const legacy=freezeQualityPlan({...plan(),holdingVetoes:[makeQualityHoldingVeto(MIRROR_DEADLINE_KIND,'>=',1)]}),before=structuredClone(legacy);
 const current=freezeQualityPlan(plan()),changed=structuredClone(current);changed.holdingVetoes![0].threshold=2;
 expect(current.frozenVersions?.find(v=>v.key==='hard-stop-mirror-loss-review')?.version).toContain(VERSION);
 expect(planVersionChanges(current)).toEqual([]);expect(planVersionChanges(changed).some(v=>v.key==='hard-stop-mirror-loss-review')).toBe(true);
 expect(legacy.holdingVetoes![0].mirrorDeadlineVersion).toBe(MIRROR_DEADLINE_VERSION);
 expect(planVersionChanges(legacy)).toEqual([]);expect(qualityPlanVersions(legacy)).toEqual(before.frozenVersions);expect(legacy).toEqual(before);
 expect(parseHoldingVetoDraft(holdingVetoDraft(legacy.holdingVetoes),[])).toEqual(legacy.holdingVetoes);
});
