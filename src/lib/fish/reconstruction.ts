/** Browser-only reconstruction. No signal mutation or persistence takes place in this module. */
import type { TradeSignal } from '@/lib/signalLibrary';
import type { ResearchBar } from '@/lib/deepRsa/window';
import { definitionKey } from '@/lib/deepDig/features';
import { compileFishProgram, evaluateFishProgram, shortFishHash, type FishProgram } from './algorithm';
import { FishError, fishDelay, validateFishBars } from './shared';

const DAY = 86_400_000, HOUR = 3_600_000, LOOKBACK = 3 * DAY;
export type FishReconstructionSkip = 'gap' | 'history' | 'retention' | 'failed' | 'readings';
export interface FishReconstructionMetrics {
  total:number; valid:number; skipped:Record<FishReconstructionSkip,number>;
  strictHits:number; looseHits:number; strictRate:number|null; looseRate:number|null;
  noiseStarts:number; matchedStarts:number; totalStarts:number; coinDays:number;
  noiseRate:number|null; precision:number|null; f1:number|null;
}
export interface FishReconstructionMatch {
  reading:number; start:number|null; strict:boolean; loose:boolean; active:boolean; unknown:boolean;
}
export interface FishReconstructionSignal {
  id:string; key:string; symbol:string; timeMs:number; split:'train'|'test';
  skip?:FishReconstructionSkip; reason?:string; reading:number|null;
  best:FishReconstructionMatch|null; current:FishReconstructionMatch|null;
}
export interface FishReconstructionScan {
  threshold:number; train:FishReconstructionMetrics; test:FishReconstructionMetrics;
}
export interface FishReconstructionAlgorithm {
  key:string; algorithmKey:string; featureId:string; label:string; statistic:string; unit:string; step:number;
  currentThreshold:number; bestThreshold:number|null; train:FishReconstructionMetrics; test:FishReconstructionMetrics;
  scan:FishReconstructionScan[]; perSignal:FishReconstructionSignal[];
}
export interface FishReconstructionResult {
  createdAt:number; fingerprint:string; algorithms:FishReconstructionAlgorithm[];
}
export interface FishReconstructionProgress {
  status:'running'|'complete'|'cancelled'; phase:'loading'|'thresholds'; done:number; total:number; current:string;
}
export interface FishReconstructionOptions {
  plans:readonly FishProgram[]; signals:readonly TradeSignal[]; signal:AbortSignal;
  onProgress:(progress:FishReconstructionProgress)=>void;
}
export type FishReconstructionLoader = (row:TradeSignal,from:number,cut:number,plan:FishProgram,signal:AbortSignal)=>Promise<readonly ResearchBar[]>;
const coinKey = (row:TradeSignal) => `${row.exchange??'binance'}|${row.market??'crypto'}|${row.symbol}`;
export const reconstructionSignalKey = (row:TradeSignal) => `${coinKey(row)}@${row.timeMs}`;
export const reconstructionAlgorithmKey = (plan:FishProgram) => shortFishHash(JSON.stringify([plan.def.id,definitionKey(plan.def),plan.def.scale,plan.def.unit,'结果','>',plan.settings.threshold]));
const check = (signal:AbortSignal) => { if(signal.aborted)throw new DOMException('已取消','AbortError'); };
const skipReason = (error:unknown):FishReconstructionSkip => error instanceof FishError ? error.kind==='skipped'?'retention':['gap','history','readings'].includes(error.kind)?error.kind as FishReconstructionSkip:'failed':'failed';
type Interval = [number,number];
function union(intervals:readonly Interval[]):Interval[] {
  const out:Interval[]=[];
  for(const [from,to] of [...intervals].sort((a,b)=>a[0]-b[0])) {
    const last=out.at(-1);if(last&&from<=last[1])last[1]=Math.max(last[1],to);else out.push([from,to]);
  }
  return out;
}
function uncovered(from:number,to:number,covered:readonly Interval[]):Interval[] {
  const out:Interval[]=[];let at=from;
  for(const [a,b] of union(covered)){if(b<=at)continue;if(a>=to)break;if(a>at)out.push([at,Math.min(a,to)]);at=Math.max(at,b);}
  if(at<to)out.push([at,to]);return out;
}
interface Sample {
  row:TradeSignal; split:'train'|'test'; cut:number; coin:string;
  skip?:FishReconstructionSkip; reason?:string; raw?:Float64Array; times?:number[];
  currentRaw?:Float64Array; currentTimes?:number[]; reading?:number;
}
interface RangeCache { bars:Map<number,ResearchBar>; covered:Interval[]; coin:string; step:number; count:number }
const rangeGroup = (plan:FishProgram) => `${plan.step}|${plan.usesTaker}|${plan.compiled.usesBtc}`;
function quantile(values:readonly number[],q:number):number {
  const a=[...values].sort((x,y)=>x-y),at=(a.length-1)*q,lo=Math.floor(at),weight=at-lo;
  return weight===0?a[lo]:a[lo]*(1-weight)+a[lo+1]*weight;
}
function crossingTimes(raw:Float64Array,times:readonly number[],threshold:number):number[] {
  const result:number[]=[];
  for(let i=1;i<raw.length;i++)if(Number.isFinite(raw[i-1])&&Number.isFinite(raw[i])&&raw[i-1]<=threshold&&raw[i]>threshold)result.push(times[i]);
  return result;
}
function match(sample:Sample,threshold:number,plan:FishProgram):FishReconstructionMatch|null {
  if(sample.skip||!sample.currentRaw?.length)return null;
  const raw=sample.currentRaw,times=sample.currentTimes!,last=raw.length-1,limit=threshold/plan.scale;
  const active=raw[last]>limit;let start:number|null=null;
  if(active){let i=last;while(i>0&&Number.isFinite(raw[i-1])&&raw[i-1]>limit)i--;
    if(i>0&&Number.isFinite(raw[i-1])&&raw[i-1]<=limit)start=times[i];}
  return {reading:sample.reading!,start,active,unknown:active&&start===null,
    strict:start!==null&&start>=sample.row.timeMs-plan.step&&start<=sample.row.timeMs,
    loose:start!==null&&start>=sample.row.timeMs-HOUR&&start<=sample.row.timeMs};
}
function metrics(samples:readonly Sample[],threshold:number,plan:FishProgram,labels:readonly TradeSignal[]):FishReconstructionMetrics {
  const out:FishReconstructionMetrics={total:samples.length,valid:0,skipped:{gap:0,history:0,retention:0,failed:0,readings:0},strictHits:0,looseHits:0,strictRate:null,looseRate:null,noiseStarts:0,matchedStarts:0,totalStarts:0,coinDays:0,noiseRate:null,precision:null,f1:null};
  const labelWindows=new Map<string,Interval[]>(),exposure=new Map<string,Interval[]>(),starts=new Map<string,Set<number>>();
  for(const row of labels){const key=coinKey(row),windows=labelWindows.get(key)??[];windows.push([row.timeMs-HOUR,row.timeMs]);labelWindows.set(key,windows);}
  for(const sample of samples){
    if(sample.skip){out.skipped[sample.skip]++;continue;}out.valid++;
    const m=match(sample,threshold,plan)!;if(m.strict)out.strictHits++;if(m.loose)out.looseHits++;
    const windows=exposure.get(sample.coin)??[];windows.push([sample.cut-LOOKBACK,sample.cut]);exposure.set(sample.coin,windows);
    const points=starts.get(sample.coin)??new Set<number>();
    for(const time of crossingTimes(sample.raw!,sample.times!,threshold/plan.scale))if(time>sample.cut-LOOKBACK&&time<=sample.cut)points.add(time);
    starts.set(sample.coin,points);
  }
  for(const windows of exposure.values())out.coinDays+=union(windows).reduce((n,[a,b])=>n+b-a,0)/DAY;
  for(const [coin,points] of starts){const windows=union(labelWindows.get(coin)??[]);for(const time of points){out.totalStarts++;if(windows.some(([a,b])=>time>=a&&time<=b))out.matchedStarts++;else out.noiseStarts++;}}
  if(out.valid){out.strictRate=out.strictHits/out.valid;out.looseRate=out.looseHits/out.valid;}
  if(out.coinDays)out.noiseRate=out.noiseStarts/out.coinDays;
  if(out.totalStarts)out.precision=out.matchedStarts/out.totalStarts;
  // With no starts and therefore no precision denominator, zero recall still has F1=0.
  if(out.valid){const precision=out.precision??0,recall=out.strictRate!;out.f1=precision+recall?2*precision*recall/(precision+recall):0;}
  return out;
}
/** Chronological requests never prefetch a later signal's tail. Every evaluated input is clipped again at that signal's cutoff. */
export async function collectFishReconstruction(options:FishReconstructionOptions,load:FishReconstructionLoader):Promise<FishReconstructionResult> {
  const {signal,onProgress}=options;
  const plans=options.plans.map(p=>compileFishProgram(p.def,{statistic:'结果',direction:'>',threshold:p.settings.threshold,constraints:[]}));
  const ordered=options.signals.map((row,index)=>({row,index})).sort((a,b)=>a.row.timeMs-b.row.timeMs||reconstructionSignalKey(a.row).localeCompare(reconstructionSignalKey(b.row))||a.index-b.index);
  const boundary=ordered.length?Math.max(1,Math.floor(ordered.length*.7)):0;
  const trainingLabels=ordered.slice(0,boundary).map(x=>x.row),allLabels=ordered.map(x=>x.row);
  const samples=plans.map(()=>[] as Sample[]),ranges=new Map<string,RangeCache>();
  // Retain at most the largest required window per period/input group. Once a coin's final signal is done, its raw bars are no longer needed at all.
  const maximumCounts=new Map<string,number>(),lastRows=new Map<string,number>();
  for(const plan of plans){const group=rangeGroup(plan);maximumCounts.set(group,Math.max(maximumCounts.get(group)??0,plan.N+Math.ceil(LOOKBACK/plan.step)));}
  ordered.forEach(({row},index)=>lastRows.set(coinKey(row),index));
  const progress:FishReconstructionProgress={status:'running',phase:'loading',done:0,total:ordered.length*plans.length,current:''};
  const publish=()=>onProgress({...progress});publish();
  try {
    for(let rowIndex=0;rowIndex<ordered.length;rowIndex++){
      for(let pi=0;pi<plans.length;pi++){
      check(signal);const row=ordered[rowIndex].row,plan=plans[pi],cut=Math.floor(row.timeMs/plan.step)*plan.step;
      const sample:Sample={row,split:rowIndex<boundary?'train':'test',cut,coin:coinKey(row)};samples[pi].push(sample);
      progress.current=`${plan.def.short||plan.def.name} · ${row.symbol}`;publish();
      try {
        if(!Number.isFinite(row.timeMs)||row.timeMs<=0||!/^[A-Z0-9_.:-]{1,80}$/.test(row.symbol))throw new FishError('标的或时间无效','readings');
        if(plan.unavailable)throw new FishError(plan.unavailable,'readings');
        const count=plan.N+Math.ceil(LOOKBACK/plan.step),from=cut-count*plan.step;
        const group=rangeGroup(plan),key=`${sample.coin}|${group}`;
        const cache:RangeCache=ranges.get(key)??{bars:new Map<number,ResearchBar>(),covered:[],coin:sample.coin,step:plan.step,count:maximumCounts.get(group)!};ranges.set(key,cache);
        for(const [a,b] of uncovered(from,cut,cache.covered)){
          check(signal);let fetched:readonly ResearchBar[];
          try{fetched=await load(row,a,b,plan,signal);}catch(error){
            // A missing new tail cannot be pre-listing history when an older part was already observed.
            if(error instanceof FishError&&error.kind==='history'&&a>from&&cache.covered.some(([x])=>x<a))throw new FishError(error.message,'gap');throw error;
          }
          check(signal);
          // Defend against permissive sources: future bars are neither retained nor fed into the formula.
          const safe=fetched.filter(bar=>bar.openTime>=a&&bar.openTime+plan.step<=b&&bar.openTime+plan.step<=row.timeMs).sort((x,y)=>x.openTime-y.openTime);
          validateFishBars(safe,b,(b-a)/plan.step,plan.step);
          for(const bar of safe)cache.bars.set(bar.openTime,bar);cache.covered=union([...cache.covered,[a,b]]);
        }
        const bars=Array.from(cache.bars.values()).filter(b=>b.openTime>=from&&b.openTime+plan.step<=cut&&b.openTime+plan.step<=row.timeMs).sort((a,b)=>a.openTime-b.openTime);
        validateFishBars(bars,cut,count,plan.step);check(signal);
        // Extended history supplies the three-day noise window. Re-evaluate the last N for exactly the scanner's cutoff reading and episode (including smoothing seeds).
        const history=evaluateFishProgram(bars,plan),currentBars=bars.slice(-plan.N),current=evaluateFishProgram(currentBars,plan),first=plan.warm-1;
        sample.raw=history.average.slice(first);sample.times=bars.slice(first).map(b=>b.openTime+plan.step);
        sample.currentRaw=current.average.slice(first);sample.currentTimes=currentBars.slice(first).map(b=>b.openTime+plan.step);
        sample.reading=current.average.at(-1)!*plan.scale;
        const needed=cut-LOOKBACK-plan.step;
        if(!Number.isFinite(sample.reading)||sample.times.some((t,i)=>t>=needed&&!Number.isFinite(sample.raw![i]))||sample.currentRaw.some(v=>!Number.isFinite(v)))throw new FishError('所需区间的序列读数不完整','readings');
      }catch(error){check(signal);sample.skip=skipReason(error);sample.reason=error instanceof Error?error.message:String(error);delete sample.raw;delete sample.times;delete sample.currentRaw;delete sample.currentTimes;delete sample.reading;}
      progress.done++;publish();await fishDelay(0,signal);
      }
      const row=ordered[rowIndex].row,coin=coinKey(row);
      for(const [key,cache] of ranges){
        if(cache.coin!==coin)continue;
        if(lastRows.get(coin)===rowIndex){ranges.delete(key);continue;}
        const from=Math.floor(row.timeMs/cache.step)*cache.step-cache.count*cache.step;
        for(const time of cache.bars.keys())if(time<from)cache.bars.delete(time);
        cache.covered=cache.covered.filter(([,to])=>to>from).map(([start,to])=>[Math.max(start,from),to]);
      }
    }
    const candidates=plans.map((plan,pi)=>{
      const values=samples[pi].filter(s=>s.split==='train'&&!s.skip).map(s=>s.reading!);
      return [...new Set([plan.settings.threshold,...(values.length?Array.from({length:19},(_,i)=>quantile(values,(i+1)*.05)):[])])].filter(Number.isFinite).sort((a,b)=>a-b);
    });
    progress.phase='thresholds';progress.done=0;progress.total=candidates.reduce((n,c)=>n+c.length,0);publish();
    const algorithms:FishReconstructionAlgorithm[]=[];
    for(let pi=0;pi<plans.length;pi++){
      const plan=plans[pi],rows=samples[pi],trainRows=rows.filter(s=>s.split==='train'),testRows=rows.filter(s=>s.split==='test'),scan:FishReconstructionScan[]=[];
      for(const threshold of candidates[pi]){check(signal);progress.current=`${plan.def.short||plan.def.name} > ${threshold}`;
        scan.push({threshold,train:metrics(trainRows,threshold,plan,trainingLabels),test:metrics(testRows,threshold,plan,allLabels)});
        progress.done++;publish();await fishDelay(0,signal);
      }
      const best=[...scan].filter(s=>s.train.valid>0).sort((a,b)=>(b.train.f1??-1)-(a.train.f1??-1)||(a.train.noiseRate??Infinity)-(b.train.noiseRate??Infinity)||a.threshold-b.threshold)[0];
      const fallback=scan.find(s=>s.threshold===plan.settings.threshold)!;
      const unavailable=(m:FishReconstructionMetrics):FishReconstructionMetrics=>({...m,strictHits:0,looseHits:0,strictRate:null,looseRate:null,noiseStarts:0,matchedStarts:0,totalStarts:0,noiseRate:null,precision:null,f1:null});
      algorithms.push({key:reconstructionAlgorithmKey(plan),algorithmKey:plan.algorithmKey,featureId:plan.def.id,label:plan.def.short||plan.def.name,statistic:'结果',unit:plan.unit,step:plan.step,currentThreshold:plan.settings.threshold,bestThreshold:best?.threshold??null,train:best?.train??unavailable(fallback.train),test:best?.test??unavailable(fallback.test),scan,
        perSignal:rows.map(s=>({id:s.row.id,key:reconstructionSignalKey(s.row),symbol:s.row.symbol,timeMs:s.row.timeMs,split:s.split,skip:s.skip,reason:s.reason,reading:s.reading??null,best:best?match(s,best.threshold,plan):null,current:match(s,plan.settings.threshold,plan)}))});
    }
    check(signal);progress.status='complete';progress.current='';publish();
    return {createdAt:Date.now(),fingerprint:shortFishHash(JSON.stringify(allLabels.map(reconstructionSignalKey).sort())),algorithms:algorithms.sort((a,b)=>(b.test.f1??-1)-(a.test.f1??-1)||(a.test.noiseRate??Infinity)-(b.test.noiseRate??Infinity))};
  }catch(error){if(signal.aborted){progress.status='cancelled';progress.current='';publish();}throw error;}
}
