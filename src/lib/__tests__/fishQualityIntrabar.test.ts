import { describe, expect, it, vi } from 'vitest';
import { definitionKey, evaluateOnBars } from '@/lib/deepDig/features';
import { evaluateQualitySample, qualityMetricPlan, qualityResultKey, type QualityGroup, type QualitySample } from '@/lib/fish/quality';
import { aggregateQualityMinute, findQualityIntrabarExit } from '@/lib/fish/qualityIntrabar';
import type { FishReconstructionLoader } from '@/lib/fish/reconstruction';
import type { ResearchBar } from '@/lib/deepRsa/window';

const M=60_000,T=Date.UTC(2026,3,2,17),signal=()=>new AbortController().signal;
const bar=(t:number,close=100,open=close):ResearchBar=>({openTime:t,open,high:Math.max(open,close),low:Math.min(open,close),close,volume:1,quoteVolume:100,takerBuyVolume:.5,takerBuyQuoteVolume:50,refClose:100});
const sample:QualitySample={id:'a',enteredAt:T,basis:'capture',importedAt:T,groups:['g'],source:{id:'a',symbol:'AAAUSDT',timeMs:T,timeLabel:'',fallbackZone:''}};
function group(formula='raw = C',threshold=95):QualityGroup {
  const def={id:'intrabar-test',name:'test',short:'test',formula,scale:1,unit:'',definition:'',positive:'1',control:'0',interval:'5m' as const};
  return {id:'g',label:'test',metric:'raw',execution:'intrabar-1m',snapshot:{featureId:def.id,definitionKey:definitionKey(def),statistic:'raw',interval:'5m',scale:1,threshold:0,direction:'>',average:0,cbi2:0,startAverage:0,previousAverage:0,cutoffMs:T},rule:{metric:'raw',direction:'<',threshold}};
}
const loader=(minute:(t:number)=>ResearchBar,coarse:(t:number)=>ResearchBar=(t)=>bar(t)):FishReconstructionLoader=>async(_row,a,b,p)=>Object.freeze(Array.from({length:(b-a)/p.step},(_,i)=>Object.freeze((p.step===M?minute:coarse)(a+i*p.step))));
const run=(g:QualityGroup,load:FishReconstructionLoader,now=T+10*M,s=sample,previous?:Awaited<ReturnType<typeof evaluateQualitySample>>)=>evaluateQualitySample(s,g,0,now,load,signal(),previous);

describe('causal intrabar sell replay',()=>{
  it('catches the first minute breach even when the original 5m candle recovers, and excludes exit-minute extremes',async()=>{
    const g=group(),path=loader(t=>t===T+M?bar(t,90,100):t===T+2*M?{...bar(t,1000,92),high:2000,low:1}:bar(t,110,100));
    const r=await run(g,path);
    expect(r).toMatchObject({status:'closed',entryPrice:100,endTime:T+2*M,endPrice:92,exitReading:90,peakPct:10,adversePct:expect.closeTo(-10),exitSnapshot:{barOpenTime:T,observedAt:T+2*M,previous:{at:T+M,reading:110}}});
    expect(r.returnPct).toBeCloseTo(-8); expect(r.drawdownPct).toBeCloseTo((110-90)/110*100);
    const old=await run({...g,execution:undefined},path);
    expect(old.status).toBe('open');
    const changed=await run(g,loader(t=>t>=T+2*M?{...bar(t,99999,t===T+2*M?92:99),high:99999,low:.001}:t===T+M?bar(t,90,100):bar(t,110,100)));
    expect(changed).toEqual(r);
  });
  it('keeps strict equality out and exits immediately when already qualified at entry',async()=>{
    const g=group('raw = C',100),load=loader(t=>bar(t,t===T?100:99));
    expect(await run(g,load)).toMatchObject({endTime:T+2*M,exitReading:99,exitSnapshot:{previous:{at:T+M,reading:100}}});
    const immediate=await run(group('raw = C',101),load);
    expect(immediate).toMatchObject({status:'closed',endTime:T,endPrice:100,returnPct:0,heldHours:0});
  });
  it('replays the pre-entry bucket prefix without including its price extremes in holding metrics',async()=>{
    const s={...sample,enteredAt:T+2*M},g=group('raw = C',95);
    const r=await run(g,loader(t=>t<T+2*M?{...bar(t,90),high:1000,low:1}:bar(t,92)),T+10*M,s);
    expect(r).toMatchObject({status:'closed',entryTime:T+2*M,endTime:T+2*M,entryPrice:92,endPrice:92,returnPct:0,peakPct:0,drawdownPct:0,exitReading:90});
  });
  it('sums only observed amounts and uses the latest observed BTC close while keeping the original indicator period',async()=>{
    const g=group('raw = Q + B + CB',230);g.rule!.direction='>';
    const load=vi.fn(loader(t=>({...bar(t),quoteVolume:t===T?10:20,takerBuyQuoteVolume:t===T?2:4,refClose:t===T?200:201}),t=>({...bar(t),quoteVolume:1,takerBuyQuoteVolume:1,refClose:100})));
    const r=await run(g,load);
    expect(r).toMatchObject({status:'closed',endTime:T+2*M,exitReading:237,exitSnapshot:{previous:{at:T+M,reading:212}}});
    expect(load.mock.calls.filter(c=>c[3].step===M).every(c=>c[3].compiled.usesBtc&&c[3].usesTaker&&c[3].compiled.usesAmounts)).toBe(true);
    expect(load.mock.calls[0][3].def.interval).toBe('5m');
    expect(aggregateQualityMinute({...bar(T),quoteVolume:null},bar(T+M),5*M).quoteVolume).toBeNull();
  });
  it('recomputes a forming EMA once per observation rather than feeding repeated partial candles into its history',async()=>{
    const g=group('raw = ema(C, 0.25)',98),{plan,scale}=qualityMetricPlan(g.snapshot,'raw');
    const minute=(t:number)=>bar(t,t<T+5*M?105:t<T+8*M?100:60);
    const history=Array.from({length:plan.warm},(_,i)=>bar(T-(plan.warm-i)*plan.step));
    // Independent oracle: fresh formula evaluation of the manually assembled prefix at every minute.
    let expected:{at:number;reading:number}|undefined;
    for(let count=1;count<=15;count++){
      const buckets=[...history];
      for(let start=0;start<count;start+=5){const chunk=Array.from({length:Math.min(5,count-start)},(_,i)=>minute(T+(start+i)*M));buckets.push({...chunk[0],high:Math.max(...chunk.map(b=>b.high)),low:Math.min(...chunk.map(b=>b.low)),close:chunk.at(-1)!.close,volume:chunk.reduce((n,b)=>n+b.volume,0),quoteVolume:chunk.reduce((n,b)=>n+b.quoteVolume!,0),takerBuyVolume:chunk.reduce((n,b)=>n+b.takerBuyVolume!,0),takerBuyQuoteVolume:chunk.reduce((n,b)=>n+b.takerBuyQuoteVolume!,0)});}
      const values=evaluateOnBars(buckets,plan.compiled,plan.def).vars.get(plan.averageName)!;const reading=(typeof values==='number'?values:values[buckets.length-1])*scale;
      if(reading<98){expected={at:T+count*M,reading};break;}
    }
    expect(expected).toBeDefined();
    const got=await findQualityIntrabarExit({row:sample.source,plan,scale,rule:g.rule!,entry:T,since:T,end:T+15*M,resumed:false,load:loader(minute),signal:signal()});
    expect(got.trigger!.at).toBe(expected!.at);expect(got.trigger!.reading).toBeCloseTo(expected!.reading,12);
  });
  it('resumes through a partial bucket identically and carries a last-minute trigger to the next update',async()=>{
    const g=group(),path=loader(t=>bar(t,t===T+3*M?90:100,t===T+4*M?92:100));
    const first=await run(g,path,T+2*M);expect(first.status).toBe('open');
    const pending=await run(g,path,T+4*M,sample,first);expect(pending.pendingExit?.at).toBe(T+4*M);expect(pending.status).toBe('open');
    const resumed=await run(g,path,T+5*M,sample,pending),whole=await run(g,path,T+5*M);
    expect(resumed).toEqual(whole);expect(resumed).toMatchObject({status:'closed',endTime:T+4*M,endPrice:92,returnPct:expect.closeTo(-8)});
  });
  it('does not skip a first hit at a 500-minute request boundary',async()=>{
    const g=group(),path=loader(t=>bar(t,t===T+500*M?90:100,t===T+501*M?92:100));
    expect(await run(g,path,T+503*M)).toMatchObject({status:'closed',endTime:T+501*M,exitReading:90,endPrice:92});
  });
  it('fails on missing minutes or unreadable inputs instead of stepping over them',async()=>{
    const g=group(),base=loader(t=>bar(t));
    const missing:FishReconstructionLoader=async(...args)=>(await base(...args)).filter(b=>args[3].step!==M||b.openTime!==T+M);
    expect(await run(g,missing)).toMatchObject({status:'error',reason:expect.stringContaining('缺根')});
    expect(await run(g,loader(t=>bar(t,t===T+M?NaN:100)))).toMatchObject({status:'error',reason:expect.stringContaining('缺失读数')});
    const controller=new AbortController();controller.abort();await expect(evaluateQualitySample(sample,g,0,T+10*M,base,controller.signal)).rejects.toMatchObject({name:'AbortError'});
  });
  it('versions timing policy independently so old cached results can never satisfy intrabar evaluation',()=>{
    const g=group(),old={...g,execution:undefined};expect(qualityResultKey(sample,g,0)).not.toBe(qualityResultKey(sample,old,0));
    expect(qualityResultKey(sample,old,0)).toBe(qualityResultKey(sample,{...old},0));
  });
});
it('retains the previous observation when the very first resumed minute triggers',async()=>{
 const g=group(),path=loader(t=>bar(t,t===T+2*M?90:100));
 const prior=await run(g,path,T+2*M),resumed=await run(g,path,T+4*M,sample,prior),whole=await run(g,path,T+4*M);
 expect(resumed).toEqual(whole);expect(resumed.exitSnapshot!.previous).toEqual({at:T+2*M,reading:100});
});
it('fills a trigger exactly at the observation horizon instead of freezing it as permanently pending',async()=>{
 const g=group(),path=loader(t=>bar(t,t===T+2*M?90:100,t===T+3*M?92:100)),hours=3/60;
 const evaluate=(now:number,prior?:Awaited<ReturnType<typeof evaluateQualitySample>>)=>evaluateQualitySample(sample,g,hours,now,path,signal(),prior);
 const pending=await evaluate(T+3*M);expect(pending.status).toBe('open');expect(pending.pendingExit!.at).toBe(T+3*M);expect(pending.complete).toBe(false);
 const full=await evaluate(T+4*M),resumed=await evaluate(T+4*M,pending);
 expect(resumed).toEqual(full);expect(full).toMatchObject({status:'closed',endTime:T+3*M,endPrice:92,complete:true});
});
