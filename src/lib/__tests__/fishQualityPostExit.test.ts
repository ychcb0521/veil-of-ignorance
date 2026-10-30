import { expect,it,vi } from 'vitest';
import { evaluateQualityPostExit,POST_EXIT_HOURS,qualityPostExitKey,mergePostExitReading,preserveQualityPostExit,postExitNeedsData,postExitValue } from '@/lib/fish/qualityPostExit';
import { collectFishQuality,newQualityStudy,qualityResultKey,type QualityGroup,type QualityResult,type QualitySample } from '@/lib/fish/quality';
import { enableQualityComparison } from '@/lib/fish/qualityComparison';
import type { FishReconstructionLoader } from '@/lib/fish/reconstruction';
import type { ResearchBar } from '@/lib/deepRsa/window';
import { FishError } from '@/lib/fish/shared';
const M=60000,T=Date.UTC(2026,9,20);
const source={id:'s',symbol:'TESTUSDT',timeMs:T,timeLabel:'',fallbackZone:''};
const plan=enableQualityComparison(newQualityStudy()).sellPlans![0];
const result:QualityResult={key:'frozen',sampleId:'s',groupId:plan.id,status:'closed',evaluatedAt:T+M,entryPrice:100,endPrice:200,endTime:T,returnPct:100};
const target={source,plan,result};
const path=(a:number,b:number)=>Array.from({length:(b-a)/M},(_,i)=>{const t=a+i*M,k=(t-T)/M+1;return {openTime:t,open:200,high:200*(1+k/10000),low:200*(1-k/20000),close:200,volume:1,quoteVolume:200,takerBuyVolume:.5,takerBuyQuoteVolume:100} satisfies ResearchBar;});
const signal=()=>new AbortController().signal;
it('computes five exact forward prefixes from the sale price in a single request, excluding all outside/future bars',async()=>{
 const load=vi.fn<FishReconstructionLoader>(async(_s,a,b)=>[...path(T-M,T),...path(a,b),{...path(b,b+M)[0],high:999999,low:1}]);
 const out=await evaluateQualityPostExit(target,load,T+6*3600000,signal());
 expect(load).toHaveBeenCalledTimes(1);expect(load.mock.calls[0].slice(1,3)).toEqual([T,T+6*3600000]);
 for(const w of out.windows){expect(w.status).toBe('ready');expect(w.peakPct).toBeCloseTo(w.hours*60/100,10);expect(w.drawdown2Pct).toBeCloseTo(w.hours*60/200,10);}
 expect(out.exitPrice).toBe(200);expect(target.result).toEqual(result);
});
it('publishes only fully elapsed windows and does not read to an unfinished 2/4/6-hour horizon',async()=>{
 const load=vi.fn<FishReconstructionLoader>(async(_s,a,b)=>path(a,b));
 const out=await evaluateQualityPostExit(target,load,T+90*M,signal());
 expect(load.mock.calls[0].slice(1,3)).toEqual([T,T+60*M]);
 expect(out.windows.map(w=>w.status)).toEqual(['ready','ready','waiting','waiting','waiting']);
 for(const h of [2,4,6])expect(postExitValue(out,h,'peak')).toBeNull();
 expect(postExitNeedsData(out,T,T+119*M)).toBe(false);expect(postExitNeedsData(out,T,T+120*M)).toBe(true);
});
it('keeps zero distinct from missing/invalid/gapped prices, and preserves earlier good windows on later data failure',async()=>{
 const flat:FishReconstructionLoader=async(_s,a,b)=>path(a,b).map(v=>({...v,high:199,low:198,open:198.5,close:198.5}));
 const zero=await evaluateQualityPostExit(target,flat,T+6*3600000,signal());expect(zero.windows[0]).toMatchObject({peakPct:0,drawdown2Pct:1});
 const load:FishReconstructionLoader=async(_s,a,b)=>{if(b>T+90*M)throw new FishError('K线缺根','gap');return path(a,b);};
 const out=await evaluateQualityPostExit(target,load,T+6*3600000,signal());
 expect(out.windows.map(w=>w.status)).toEqual(['ready','ready','error','error','error']);
 expect(postExitValue(out,2,'drawdown2')).toBeNull();
 const before=JSON.stringify(out);
 const retried=await evaluateQualityPostExit(target,async()=>{throw Error('暂不可用');},T+7*3600000,signal(),out);
 expect(retried.windows[0]).toEqual(out.windows[0]);expect(JSON.stringify(out)).toBe(before);
 const invalid=await evaluateQualityPostExit(target,async(_s,a,b)=>path(a,b).map(v=>({...v,high:NaN})),T+6*3600000,signal());
 expect(invalid.windows.every(w=>w.status==='error'&&w.peakPct==null&&w.drawdown2Pct==null)).toBe(true);
});
it('excludes the unknown pre/post-fill minute for intraminute stops, but retains observable opening fills',async()=>{
 const stopPlan={...plan,vetoFill:'stop' as const};
 const stopped={...result,exitSnapshot:{barOpenTime:T,observedAt:T,cause:{id:'s',kind:'static-drawdown' as const,label:'止损',direction:'>=' as const,threshold:5}}};
 const load=vi.fn<FishReconstructionLoader>(async(_s,a,b)=>path(a,b).map(v=>v.openTime===T?{...v,high:10000,low:1}:v));
 const out=await evaluateQualityPostExit({...target,plan:stopPlan,result:stopped},load,T+6*3600000,signal());
 expect(out.excludedExitMinute).toBe(true);expect(load.mock.calls[0][1]).toBe(T+M);expect(out.windows[0].peakPct).toBeCloseTo(.3,10);
 const opened={...stopped,exitSnapshot:{...stopped.exitSnapshot,atOpen:true}};
 const first=await evaluateQualityPostExit({...target,plan:stopPlan,result:opened},load,T+6*3600000,signal());
 expect(first.excludedExitMinute).toBe(false);expect(first.windows[0].peakPct).toBe(4900);
});
it('separates exit-price/time/venue identities and merges durable successes without rewriting trading results',async()=>{
 const a=await evaluateQualityPostExit(target,async(_s,x,y)=>path(x,y),T+6*3600000,signal());
 expect(qualityPostExitKey(source,{...result,endPrice:201},plan)).not.toBe(a.key);
 expect(qualityPostExitKey(source,{...result,endTime:T+M},plan)).not.toBe(a.key);
 expect(qualityPostExitKey({...source,exchange:'bybit'},result,plan)).not.toBe(a.key);
 expect(qualityPostExitKey(source,{...result,status:'open'},plan)).toBeNull();
 const bad={...a,evaluatedAt:a.evaluatedAt+M,windows:POST_EXIT_HOURS.map(hours=>({hours,status:'error' as const,error:'断线'}))};
 expect(mergePostExitReading(a,bad).windows).toEqual(a.windows);
 const base={...newQualityStudy(),results:[result]},saved={...base,postExitReadings:[a]};
 const restored=preserveQualityPostExit(saved,{...base,postExitReadings:[bad]});expect(restored.postExitReadings![0].windows).toEqual(a.windows);expect(restored.results).toBe(base.results);
 const sample:QualitySample={id:'s',source,enteredAt:T-3600000,importedAt:T,basis:'capture',groups:[]};
 expect(qualityResultKey(sample,plan,0)).toBe(qualityResultKey(sample,{...plan},0));
});
it('runs retrospective requests without calling the trading result callback, deduplicates equivalent exits and observes cancellation',async()=>{
 const onResult=vi.fn(),onReading=vi.fn(),load=vi.fn<FishReconstructionLoader>(async(_s,a,b)=>path(a,b));
 const study={...newQualityStudy(),results:[result]},before=JSON.stringify(study);
 await collectFishQuality({study,signal:signal(),task:'post-exit',postExitTargets:[target,{...target,plan:{...plan,id:'other'}}],onProgress:()=>{},onResult,onPostExitReading:onReading},load,T+6*3600000);
 expect(onResult).not.toHaveBeenCalled();expect(onReading).toHaveBeenCalledTimes(1);expect(load).toHaveBeenCalledTimes(1);expect(JSON.stringify(study)).toBe(before);
 const aborter=new AbortController();aborter.abort();await expect(evaluateQualityPostExit(target,load,T+6*3600000,aborter.signal)).rejects.toThrow('已取消');
});
