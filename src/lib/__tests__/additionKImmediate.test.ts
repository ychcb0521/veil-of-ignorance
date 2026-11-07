import { expect,it } from 'vitest';
import { findCalculatorAdditions } from '@/lib/fish/qualityAdditionCalculator';
import { ADDITION_K_TOUCH_VERSION, additionIdentity, type QualityAdditionFill } from '@/lib/fish/qualityAddition';
import { defaultStructureAddition } from '@/lib/fish/qualityAdditionStructure';
import { qualityAdditionStopOrder } from '@/lib/fish/qualityAdditionStopOrder';
import { freezeQualityPlan, planVersionChanges } from '@/lib/fish/qualityPlanVersions';
import type { QualityGroup } from '@/lib/fish/quality';
import {evaluateQualitySample,qualityResultKey,type QualityResult,type QualitySample} from '@/lib/fish/quality';
import type { FishReconstructionLoader } from '@/lib/fish/reconstruction';
import type { ResearchBar } from '@/lib/deepRsa/window';
const M=60000,T=Date.UTC(2026,10,1),K=95,F=93;
const bar=(i:number,open=96,low=95.9,close=open):ResearchBar=>({openTime:T+i*M,open,high:Math.max(open,close)+.1,low,close,volume:1,takerBuyVolume:.5,quoteVolume:100,takerBuyQuoteVolume:50});
const fill=(floor=true,guardCloses=2):QualityAdditionFill=>({at:T,price:100,quantity:1,notional:100,scanFrom:T-M,reading:0,threshold:0,direction:'>',metric:'confirmed_support',label:'guard',barOpenTime:T-5*M,
 structureEvidence:{guardCloses} as QualityAdditionFill['structureEvidence'],sizing:{support:floor?F:K,...(floor?{guardK:K,floorAtr:2}:{}),previousSupport:90,atr:1,atrAt:T,coinsBefore:1,realAverageBefore:90,baseCoins:1,mirrorCoins:0,mirrorUsed:0}});
const load:FishReconstructionLoader=async(_r,a,b,p)=>Array.from({length:(b-a)/p.step},(_,i)=>({...bar(0),openTime:a+i*p.step,open:90,high:91,low:89,close:90}));
const options=(prices:ResearchBar[],floor=true)=>({row:{id:'x',symbol:'RAVEUSDT',timeMs:T,timeLabel:'',fallbackZone:''},entry:T-10*M,entryPrice:90,notional:100,since:T,end:prices.at(-1)!.openTime+M,prices,previous:[fill(floor)],mirror:{at:T-5*M,price:100,fraction:.5,gainPct:10,atOpen:true},repeat:false,maxRounds:1,candidates:[],load,signal:new AbortController().signal});
it('reproduces the screenshot: old guard waits; immediate K catches a wick above F, including the addition minute',async()=>{
 const prices=Array.from({length:4},(_,i)=>bar(i,96,i===0?K:95.9));
 const old=await findCalculatorAdditions(options(prices));expect(old.stop).toBeUndefined();
 const now=await findCalculatorAdditions({...options(prices),kStopVersion:ADDITION_K_TOUCH_VERSION});
 expect(now.stop).toMatchObject({at:T,price:K,support:K,atOpen:false});expect(now.stop?.confirmCloses).toBeUndefined();
 expect(now.fills).toEqual(old.fills); // Execution-only upgrade: no quantity or sizing changes.
});
it('uses the observable gap open at K rather than waiting for F or a 5m close',async()=>{
 const prices=[bar(0),bar(1,94,93.5,94),bar(2,96)];
 expect((await findCalculatorAdditions({...options(prices),kStopVersion:ADDITION_K_TOUCH_VERSION})).stop).toMatchObject({at:T+M,price:94,support:K,atOpen:true});
 expect((await findCalculatorAdditions(options(prices))).stop).toBeUndefined();
});
it('touches the guard K directly even without a breakeven F, for both guard regimes',async()=>{
 for(const closes of [1,2]){
 const o=options([bar(0),bar(1,96,94,96)],false);o.previous=[fill(false,closes)];
 expect((await findCalculatorAdditions({...o,kStopVersion:ADDITION_K_TOUCH_VERSION})).stop).toMatchObject({at:T+M,price:K});
 }
});
it('does not wait for the final replay candle to close and includes decimal equality tolerance',async()=>{
 const prices=[bar(0),bar(1,96,K*(1+5e-13),96)];
 expect((await findCalculatorAdditions({...options(prices),kStopVersion:ADDITION_K_TOUCH_VERSION})).stop).toMatchObject({at:T+M,price:K});
});
it('resumed execution reaches the same K touch as one continuous pass',async()=>{
 const prices=[bar(0),bar(1),bar(2),bar(3,96,94,96),bar(4)];
 const all=await findCalculatorAdditions({...options(prices),kStopVersion:ADDITION_K_TOUCH_VERSION});
 const first=await findCalculatorAdditions({...options(prices.slice(0,3)),kStopVersion:ADDITION_K_TOUCH_VERSION});expect(first.stop).toBeUndefined();
 const rest=await findCalculatorAdditions({...options(prices.slice(3)),since:T+3*M,previous:first.fills,kStopVersion:ADDITION_K_TOUCH_VERSION});expect(rest.stop).toEqual(all.stop);
});
it('after an accepted support reduction the new guard K prime is immediately active above F prime',async()=>{
 const prices=[bar(1,94,93.5,94),bar(2,94,93,94),bar(3,94,93.5,94)];
 const reduction={at:T+M,price:96,fraction:0,quantity:0,costRemoved:0,realizedPnl:0,breakeven:90,previousK:F,newK:91,newGuardK:93,previousSupport:K,newSupport:93,atr:1};
 const r=await findCalculatorAdditions({...options(prices),since:T+M,previousReductions:[reduction],kStopVersion:ADDITION_K_TOUCH_VERSION});
 expect(r.stop).toMatchObject({at:T+2*M,price:93,support:93,atOpen:false});
});
it('the full holding monitor forwards the selected version and records a real K exit rather than waiting for F',async()=>{
 const sample:QualitySample={id:'sample',enteredAt:T-10*M,basis:'signal',importedAt:T,groups:[],source:{id:'row',symbol:'RAVEUSDT',timeMs:T-10*M,timeLabel:'',fallbackZone:''}};
 const minutes=Array.from({length:5},(_,i)=>bar(i,96,i===1?K:95.9)),byTime=new Map(minutes.map(b=>[b.openTime,b]));
 const replay:FishReconstructionLoader=async(_r,a,b,p)=>Array.from({length:(b-a)/p.step},(_,i)=>{const at=a+i*p.step;return p.step===M?byTime.get(at)??{...bar(0),openTime:at}:{...bar(0),openTime:at,open:90,high:91,low:89,close:90};});
 for(const immediate of [false,true]){
 const addition={enabled:true,source:'structure' as const,structure:{...defaultStructureAddition(),kSource:'guard' as const},stricterPct:10,quantityMode:'calculator' as const,maxRounds:1,repeat:false,breakevenFloor:{enabled:true,atr:2},...(immediate?{kStopVersion:ADDITION_K_TOUCH_VERSION}:{})};
 const plan={id:'p',label:'p',metric:'raw',vetoFill:'stop',snapshot:{featureId:'x',definitionKey:'C',statistic:'raw',scale:1,interval:'5m'},addition} as QualityGroup;
 const previous={key:qualityResultKey(sample,plan,0),sampleId:sample.id,groupId:plan.id,evaluatedAt:T,status:'open',entryTime:sample.enteredAt,entryPrice:90,endTime:T,endPrice:96,additionFill:fill(),additionFills:[fill()],mirrorFill:{at:T-5*M,price:100,fraction:.5,gainPct:10,atOpen:true}} as QualityResult;
 const result=await evaluateQualitySample(sample,plan,0,T+5*M,replay,new AbortController().signal,previous);
 if(immediate)expect(result).toMatchObject({status:'closed',endTime:T+M,endPrice:K,exitSnapshot:{cause:{kind:'addition-support',threshold:K}}});
 else expect(result).toMatchObject({status:'open'});
 expect(result.additionFills?.[0].sizing).toEqual(previous.additionFills![0].sizing);
 }
});
it('records immediate K consistently in orders, result identity and the frozen plan manifest',()=>{
 const f={...fill(),kStopVersion:ADDITION_K_TOUCH_VERSION};
 const order=qualityAdditionStopOrder({quality_addition_fill:f});expect(order?.price).toBe(K);expect(order?.detail).toContain('价格碰到 K 即卖出全部持仓');expect(order?.detail).not.toContain('收盘连续');
 const addition={enabled:true,source:'structure' as const,structure:{...defaultStructureAddition(),kSource:'guard' as const},stricterPct:10,quantityMode:'calculator' as const,maxRounds:1};
 const upgraded={...addition,kStopVersion:ADDITION_K_TOUCH_VERSION};expect(additionIdentity(addition)).not.toEqual(additionIdentity(upgraded));
 const plan=freezeQualityPlan({id:'p',label:'p',metric:'raw',snapshot:{featureId:'x',definitionKey:'C',statistic:'raw'},addition:upgraded} as QualityGroup);
 expect(plan.frozenVersions?.find(v=>v.key==='addition-k-stop')?.version).toBe(ADDITION_K_TOUCH_VERSION);expect(planVersionChanges(plan)).toEqual([]);
 expect(planVersionChanges({...plan,addition})).not.toEqual([]);
});
