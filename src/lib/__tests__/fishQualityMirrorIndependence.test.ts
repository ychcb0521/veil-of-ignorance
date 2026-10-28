import {expect,it} from 'vitest';
import {definitionKey} from '@/lib/deepDig/features';
import {evaluateQualitySample,type QualityGroup,type QualitySample} from '@/lib/fish/quality';
import type {FishReconstructionLoader} from '@/lib/fish/reconstruction';
import type {ResearchBar} from '@/lib/deepRsa/window';
const M=60000,T=Date.UTC(2026,9,28),sig=()=>new AbortController().signal;
const b=(t:number,open=100,high=open,low=open,close=open):ResearchBar=>({openTime:t,open,high,low,close,volume:1,quoteVolume:100,takerBuyVolume:.5,takerBuyQuoteVolume:50});
const sample:QualitySample={id:'s',groups:[],enteredAt:T,basis:'signal',importedAt:T,source:{id:'s',symbol:'TESTUSDT',timeMs:T,timeLabel:'',fallbackZone:''}};
const def={id:'test',name:'test',short:'test',definition:'',formula:'raw = C',scale:1,unit:'',positive:'1',control:'0',interval:'5m' as const};
const group=(intrabar=true):QualityGroup=>({id:'g',label:'price',metric:'raw',...(intrabar?{execution:'intrabar-1m' as const}:{}),rule:{metric:'raw',direction:'<',threshold:95},snapshot:{featureId:'test',definitionKey:definitionKey(def),statistic:'raw',interval:'5m',scale:1,threshold:95,direction:'<',average:0,cbi2:0,startAverage:0,previousAverage:0,cutoffMs:T}});
const load=(f:(t:number)=>ResearchBar):FishReconstructionLoader=>async(_r,a,z,p)=>Array.from({length:(z-a)/p.step},(_,i)=>{
 const t=a+i*p.step;if(p.step===M)return f(t);const chunk=Array.from({length:p.step/M},(_,j)=>f(t+j*M));return {...chunk[0],high:Math.max(...chunk.map(x=>x.high)),low:Math.min(...chunk.map(x=>x.low)),close:chunk.at(-1)!.close};
});
const mirror={enabled:true,gainPct:5,sellPct:50};
const run=(g:QualityGroup,l:FishReconstructionLoader,minutes=12,prior?:Awaited<ReturnType<typeof evaluateQualitySample>>)=>evaluateQualitySample(sample,g,0,T+minutes*M,l,sig(),prior);
it('keeps the original candle-close confirmation after a mirror reduction, rather than switching the remaining position to intrabar selling',async()=>{
 const g=group(false),path=load(t=>t===T?b(t,100,106,100,104):t===T+M?b(t,104,104,90,90):t===T+9*M?b(t,100,100,90,90):t===T+10*M?b(t,92):b(t));
 const plain=await run(g,path),half=await run({...g,mirrorTakeProfit:mirror},path);
 expect(plain).toMatchObject({status:'closed',endTime:T+10*M,endPrice:92});
 expect(half).toMatchObject({status:'closed',endTime:plain.endTime,endPrice:plain.endPrice,mirrorFill:{price:105,fraction:.5}});
 expect(half.pnl).toBeCloseTo(-1.5);expect(half.returnPct).toBeCloseTo(-1.5);
});
it('continues the remaining coins with the same intrabar threshold and supports losses and exact resume parity',async()=>{
 const g=group(),path=load(t=>t===T?b(t,100,106,100,104):t===T+4*M?b(t,100,100,90,90):t===T+5*M?b(t,90):b(t));
 const plain=await run(g,path),mg={...g,mirrorTakeProfit:mirror},half=await run(mg,path),partial=await run(mg,path,2),resumed=await run(mg,path,12,partial);
 expect(partial).toMatchObject({status:'open',remainingFraction:.5,mirrorFill:{price:105}});
 expect(half).toMatchObject({status:plain.status,endTime:plain.endTime,endPrice:plain.endPrice});
 expect(resumed).toEqual(half);expect(half.pnl).toBeCloseTo(2.5-5);expect(half.returnPct).toBeCloseTo((2.5-5)/100*100);
});
it('retains all original sell decisions and profits when the mirror threshold never triggers',async()=>{
 const g=group(),path=load(t=>t===T+4*M?b(t,100,104,90,90):t===T+5*M?b(t,93):b(t));
 const a=await run(g,path),z=await run({...g,mirrorTakeProfit:mirror},path);
 for(const key of ['status','endTime','endPrice','exitReading','pnl','returnPct','peakPct'] as const)expect(z[key]).toEqual(a[key]);expect(z.mirrorFill).toBeUndefined();
});

it.each([[90,-2.5],[110,7.5]])('adds the mirror profit to remaining PnL at exit price %s and divides by the entire initial notional',async(exitPrice,total)=>{
 const path=load(t=>t===T?b(t,100,106,100,104):t===T+4*M?b(t,100,100,90,90):t===T+5*M?b(t,exitPrice):b(t));
 const r=await run({...group(),mirrorTakeProfit:mirror},path);
 expect(r).toMatchObject({initialNotional:100,mirrorRealizedPnl:expect.closeTo(2.5),remainingPnl:expect.closeTo(total-2.5),pnl:expect.closeTo(total),returnPct:expect.closeTo(total/100*100)});
});
it('does not change a combo switch point, its after-stage exit, or resume decisions after reducing the position',async()=>{
 const g=group();g.combo={switchPct:5.1,beforeLabel:'before',after:{label:'after',metric:'raw',snapshot:g.snapshot,rule:{metric:'raw',direction:'<',threshold:104}}};
 const path=load(t=>t<T?b(t):t===T?b(t,100,106,100,106):t===T+M?b(t,106,106,105,105):t===T+2*M?b(t,105,105,103,103):b(t,102));
 const plain=await run(g,path),mg={...g,mirrorTakeProfit:mirror},half=await run(mg,path),prior=await run(mg,path,2),resumed=await run(mg,path,12,prior);
 expect(half).toMatchObject({endTime:plain.endTime,endPrice:plain.endPrice,exitSnapshot:{stage:'after'}});expect(resumed).toEqual(half);expect(half.pnl).toBeCloseTo(3.5);
});
it.each(['static-drawdown','dynamic-drawdown','drop-1m','drop-5m'] as const)('leaves the original %s veto unchanged on the remaining position',async(kind)=>{
 const g={...group(),holdingVetoes:[{id:'risk',label:kind,kind,direction:'>=' as const,threshold:5,enabled:true}]};
 const path=load(t=>t<T?b(t):t===T?b(t,100,106,100,106):t===T+M?b(t,106):t===T+2*M?b(t,106,106,90,90):b(t,92));
 const plain=await run(g,path),half=await run({...g,mirrorTakeProfit:mirror},path);
 expect(half.mirrorFill?.price).toBe(105);expect(half).toMatchObject({status:plain.status,endTime:plain.endTime,endPrice:plain.endPrice,exitSnapshot:{cause:{kind}}});
 expect(half.pnl).toBeCloseTo(2.5+50*(plain.endPrice!/100-1));
});
