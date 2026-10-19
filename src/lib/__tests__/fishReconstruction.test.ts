import { describe, expect, it, vi } from 'vitest';
import { CBI2_DEF } from '@/lib/deepDig/features';
import { compileFishProgram, evaluateFishProgram, classifyFishProgram, type FishProgram } from '@/lib/fish/algorithm';
import { collectFishReconstruction, reconstructionAlgorithmKey, type FishReconstructionLoader, type FishReconstructionProgress } from '@/lib/fish/reconstruction';
import { FishError } from '@/lib/fish/shared';
import type { TradeSignal } from '@/lib/signalLibrary';
import type { ResearchBar } from '@/lib/deepRsa/window';

const DAY=86_400_000, STEP=300_000, anchor=Date.UTC(2026,5,20);
const plan=compileFishProgram({...CBI2_DEF,id:'reconstruction-test',name:'Reconstruction',short:'R',formula:'avg_X = C',scale:1,unit:'点'}, {statistic:'结果',direction:'>',threshold:1.5,constraints:[]});
const row=(symbol:string,timeMs=anchor):TradeSignal=>({id:`${symbol}@${timeMs}`,symbol,timeMs,timeLabel:'',fallbackZone:''});
const bar=(openTime:number,close:number):ResearchBar=>({openTime,open:close,close,high:close+1,low:Math.max(.01,close-1),volume:1,quoteVolume:100,takerBuyQuoteVolume:50,takerBuyVolume:.5});
const bars=(from:number,cut:number,p:FishProgram,value:(closeTime:number)=>number)=>Array.from({length:(cut-from)/p.step},(_,i)=>bar(from+i*p.step,value(from+(i+1)*p.step)));
const run=(signals:TradeSignal[],load:FishReconstructionLoader,plans:FishProgram[]=[plan])=>collectFishReconstruction({plans,signals,signal:new AbortController().signal,onProgress:()=>{}},load);
const resultWithoutTime=(r:Awaited<ReturnType<typeof run>>)=>({...r,createdAt:0});

describe('local fishing reconstruction',()=>{
 it('keeps algorithm identities distinct when feature or display scale changes',()=>{
   const scaled=compileFishProgram({...plan.def,scale:2},plan.settings),renamed=compileFishProgram({...plan.def,id:'other-feature'},plan.settings);
   expect(reconstructionAlgorithmKey(scaled)).not.toBe(reconstructionAlgorithmKey(plan));
   expect(reconstructionAlgorithmKey(renamed)).not.toBe(reconstructionAlgorithmKey(plan));
 });
 it('never requests or evaluates bars beyond each signal; unsorted rows, unaligned timestamps and changed future prices give identical results',async()=>{
   const rows=[row('AAAUSDT',anchor+STEP+12345),row('AAAUSDT',anchor+12345)],requests:{from:number;cut:number;t:number}[]=[];let future=100;
   const loader:FishReconstructionLoader=async(r,from,cut,p)=>{requests.push({from,cut,t:r.timeMs});return [...bars(from,cut,p,t=>t>=anchor?2:1),bar(cut,future),bar(cut+p.step,future)];};
   const first=await run(rows,loader);future=99999;requests.length=0;const second=await run(rows,loader);
   expect(resultWithoutTime(second)).toEqual(resultWithoutTime(first));expect(requests.every(r=>r.cut<=r.t)).toBe(true);
   expect(requests.map(r=>r.cut)).toEqual([anchor,anchor+STEP]);expect(requests[1].from).toBe(anchor);
   const m=first.algorithms[0].perSignal[0].current!;expect(m).toMatchObject({reading:2,start:anchor,strict:true,loose:true});
 });
 it('uses each algorithm period for cutoff and keeps the exact last-N cutoff reading and crossing used by standalone fishing',async()=>{
   const smooth=compileFishProgram({...plan.def,id:'smooth',formula:'avg_X = ema(C, 0.25)',scale:3},{...plan.settings,threshold:5});
   const p15=compileFishProgram({...plan.def,id:'fifteen',interval:'15m'},{...plan.settings,threshold:1.5});
   const r=row('AAAUSDT',anchor+2*STEP+12345),cuts:{step:number;cut:number}[]=[];
   const loader:FishReconstructionLoader=async(_r,a,b,p)=>{cuts.push({step:p.step,cut:b});return bars(a,b,p,t=>t>=anchor-10*STEP?2:1);};
   const out=await run([r],loader,[smooth,p15]);expect(cuts.map(x=>[x.step,x.cut])).toEqual([[STEP,anchor+2*STEP],[3*STEP,anchor]]);
   const cutoff=anchor+2*STEP,exactBars=bars(cutoff-smooth.N*STEP,cutoff,smooth,t=>t>=anchor-10*STEP?2:1),values=evaluateFishProgram(exactBars,smooth),classified=classifyFishProgram(r.symbol,exactBars,values,cutoff,smooth);
   const got=out.algorithms.find(a=>a.featureId==='smooth')!.perSignal[0].current!;
   expect(got.reading).toBe(values.average.at(-1)!*smooth.scale);expect(got.start).toBe(classified.signal?.timeMs??null);
 });
 it('hand-checks strict/loose capture, known-false crossings, noise attribution and F1; all-true history is valid but unknown',async()=>{
   const rows=Array.from({length:10},(_,i)=>row(`COIN${i}USDT`,anchor+i*DAY));
   const loader:FishReconstructionLoader=async(r,a,b,p)=>bars(a,b,p,t=>{
     const i=Number(r.symbol.match(/COIN(\d+)/)![1]);if(i===9)return 2;
     const start=r.timeMs-(i===8?6*STEP:0);return t>=start||t===r.timeMs-2*3_600_000?2:1;
   });
   const alg=(await run(rows,loader)).algorithms[0],stats=alg.scan.find(s=>s.threshold===1.5)!.test;
   expect(alg.bestThreshold).toBe(1.5);expect(stats).toMatchObject({total:3,valid:3,strictHits:1,looseHits:2,strictRate:1/3,looseRate:2/3,totalStarts:4,matchedStarts:2,noiseStarts:2,coinDays:9,noiseRate:2/9,precision:.5});
   expect(stats.f1).toBeCloseTo(.4);expect(alg.perSignal[9].current).toMatchObject({active:true,unknown:true,start:null,strict:false,loose:false});
   expect(alg.perSignal[8].current).toMatchObject({start:rows[8].timeMs-6*STEP,strict:false,loose:true});
 });
 it('counts the inclusive one-bar and one-hour capture boundaries exactly',async()=>{
   const rows=[row('ONEUSDT'),row('HOURUSDT'),row('OLDUSDT')];
   const alg=(await run(rows,async(r,a,b,p)=>bars(a,b,p,t=>t>=r.timeMs-(r.symbol==='ONEUSDT'?STEP:r.symbol==='HOURUSDT'?3_600_000:3_600_000+STEP)?2:1))).algorithms[0];
   expect(alg.perSignal.find(s=>s.symbol==='ONEUSDT')!.current).toMatchObject({strict:true,loose:true});
   expect(alg.perSignal.find(s=>s.symbol==='HOURUSDT')!.current).toMatchObject({strict:false,loose:true});
   expect(alg.perSignal.find(s=>s.symbol==='OLDUSDT')!.current).toMatchObject({strict:false,loose:false});
 });
 it('reuses overlapping windows without fetching any candle twice, deduplicates noise starts and unions coin-day exposure',async()=>{
   const rows=[row('AAAUSDT'),row('AAAUSDT',anchor+STEP),row('AAAUSDT',anchor+2*STEP),row('AAAUSDT',anchor+3*STEP)],seen=new Set<number>();
   const load=vi.fn<FishReconstructionLoader>(async(_r,a,b,p)=>{for(let t=a;t<b;t+=p.step){expect(seen.has(t)).toBe(false);seen.add(t);}return bars(a,b,p,t=>t===anchor-2*3_600_000?2:1);});
   const alg=(await run(rows,load)).algorithms[0];expect(load).toHaveBeenCalledTimes(4);expect(load.mock.calls[1][1]).toBe(anchor);expect(load.mock.calls[1][2]).toBe(anchor+STEP);
   const metrics=alg.scan.find(s=>s.threshold===1.5)!.test;expect(metrics.totalStarts).toBe(1);expect(metrics.noiseStarts).toBe(1);expect(metrics.coinDays).toBeCloseTo(3+STEP/DAY);
 });
 it('prunes completed history without refetching overlap across algorithms with different N',async()=>{
   const longer=compileFishProgram({...plan.def,id:'long-history',halfLifeHours:12},plan.settings);
   expect(longer.N).toBeGreaterThan(plan.N);
   const signals=[row('AAAUSDT'),row('AAAUSDT',anchor+STEP),row('AAAUSDT',anchor+8*DAY),row('AAAUSDT',anchor+8*DAY+STEP)],seen=new Set<number>();
   const load=vi.fn<FishReconstructionLoader>(async(r,a,b,p)=>{for(let t=a;t<b;t+=p.step){expect(seen.has(t)).toBe(false);seen.add(t);}return bars(a,b,p,t=>t===r.timeMs?2:1);});
   const result=await run(signals,load,[longer,plan]);
   expect(result.algorithms.every(a=>a.perSignal.every(s=>!s.skip&&s.current?.strict))).toBe(true);
   expect(load).toHaveBeenCalledTimes(4);
   expect(load.mock.calls[1].slice(1,3)).toEqual([anchor,anchor+STEP]);
   expect(load.mock.calls[3].slice(1,3)).toEqual([anchor+8*DAY,anchor+8*DAY+STEP]);
 });
 it('uses only the first 70% to generate thresholds and choose the best; reports only heldout rows',async()=>{
   const rows=Array.from({length:10},(_,i)=>row(`C${i}USDT`,anchor+i*DAY));let testValue=100;
   const load:FishReconstructionLoader=async(r,a,b,p)=>bars(a,b,p,t=>t===r.timeMs?(Number(r.symbol.match(/C(\d+)/)![1])<7?2:testValue):1);
   const first=(await run([...rows].reverse(),load)).algorithms[0];testValue=1_000_000;const second=(await run(rows,load)).algorithms[0];
   expect(first.scan.map(s=>s.threshold)).toEqual([1.5,2]);expect(second.bestThreshold).toBe(first.bestThreshold);expect(second.scan.map(s=>s.threshold)).toEqual(first.scan.map(s=>s.threshold));
   expect(first.train.total).toBe(7);expect(first.test.total).toBe(3);expect(first.perSignal.map(s=>s.split)).toEqual([...Array(7).fill('train'),...Array(3).fill('test')]);
 });
 it('keeps history, gap, retention, request and reading skips separate and outside valid denominators',async()=>{
   const names=['AAA','GAP','HIST','RET','FAIL','NAN','BBB','CCC','DDD','EEE'],rows=names.map(s=>row(`${s}USDT`));
   const load:FishReconstructionLoader=async(r,a,b,p)=>{
     if(r.symbol==='HISTUSDT')throw new FishError('not listed','history');if(r.symbol==='RETUSDT')throw new FishError('retention','skipped');if(r.symbol==='FAILUSDT')throw new Error('network');
     const result=bars(a,b,p,t=>t===r.timeMs?2:1);if(r.symbol==='GAPUSDT')result.splice(100,1);if(r.symbol==='NANUSDT')result[result.length-1].close=NaN;return result;
   };
   const alg=(await run(rows,load)).algorithms[0],all=[alg.train,alg.test];
   for(const reason of ['gap','history','retention','failed','readings'] as const)expect(all.reduce((n,m)=>n+m.skipped[reason],0)).toBe(1);
   expect(all.reduce((n,m)=>n+m.valid,0)).toBe(5);expect(alg.perSignal.filter(s=>s.skip).every(s=>s.current===null&&s.best===null&&s.reading===null)).toBe(true);
 });
 it('does not count a future heldout label as evidence when choosing a training threshold',async()=>{
   // Crossing 30m before the heldout signal is later than all training timestamps, so it is never fetched for training.
   const rows=Array.from({length:10},(_,i)=>row('AAAUSDT',anchor+i*3_600_000));
   const load:FishReconstructionLoader=async(_r,a,b,p)=>bars(a,b,p,t=>t===anchor+6.5*3_600_000?2:1);
   const alg=(await run(rows,load)).algorithms[0];expect(alg.train.totalStarts).toBe(0);expect(alg.train.matchedStarts).toBe(0);expect(alg.test.matchedStarts).toBe(1);
 });
 it('does not invent a best threshold or report best-threshold rates when training has no valid rows',async()=>{
   const signals=[row('OLDUSDT',anchor),row('NEWUSDT',anchor+DAY)];
   const alg=(await run(signals,async(r,a,b,p)=>{if(r.symbol==='OLDUSDT')throw new FishError('too old','skipped');return bars(a,b,p,t=>t===r.timeMs?2:1);})).algorithms[0];
   expect(alg.bestThreshold).toBeNull();expect(alg.test).toMatchObject({valid:1,total:1,strictRate:null,looseRate:null,precision:null,f1:null});
   expect(alg.perSignal[1].best).toBeNull();expect(alg.perSignal[1].current).toMatchObject({strict:true});
 });
 it('cancellation remains responsive between work chunks and does not return a partial result',async()=>{
   const controller=new AbortController(),progress:FishReconstructionProgress[]=[];
   const load:FishReconstructionLoader=async(_r,a,b,p)=>{controller.abort();return bars(a,b,p,()=>1);};
   await expect(collectFishReconstruction({plans:[plan],signals:[row('AAAUSDT')],signal:controller.signal,onProgress:p=>progress.push(p)},load)).rejects.toMatchObject({name:'AbortError'});
   expect(progress.at(-1)?.status).toBe('cancelled');
 });
});
